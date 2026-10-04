-- Photos and other attachments (SPEC §2, §8, §22 "Destructive actions require
-- reason and create audit records"; DATA-MODEL.md §2, §15, §16).
--
-- Rules encoded here:
--   * An attachment row describes one object in Supabase Storage:
--     `internal` and `customer` rows live in media-internal, `public` rows in
--     media-public, at `{entity_type}/{entity_id}/{attachment_id}.{ext}`
--     with an extension that matches its media type. The table enforces
--     both for every writer.
--   * Rows are created only by record_attachment, after the client has
--     uploaded the object (to a signed upload URL the server minted for that
--     exact path). It checks the caller is active staff, the entity exists,
--     the path shape, and that the object really is in storage.objects.
--     Replaying the same call returns the same row.
--   * Visibility changes only through set_attachment_visibility. Moving to
--     or from `public` changes bucket: the server copies the object first
--     and then calls the RPC with the new location, which must exist.
--   * Deleting needs a reason (delete_attachment). The row goes; an
--     attachment_events row keeps who, when, why and a snapshot of the row.
--     The server removes the object after the RPC succeeds. An attachment
--     id is never reused.
--   * attachment_events is append-only and records every create, visibility
--     change, caption change and delete, written by triggers.
--   * Attachments of a customer record are never public (PLAN D13).
--   * Which entity types can have attachments grows by phase: this
--     migration knows customers and bikes. private.attachment_entity_exists
--     is the extension point; a later phase adds its table's branch there
--     (create or replace) in the migration that creates the table.
--   * Customer access boundary: base tables are for active staff only;
--     customers see `customer`/`public` rows of their own bikes through
--     my_bike_attachments() (customer access migration).

create type public.attachment_entity as enum (
  'bike',
  'work_order',
  'product',
  'inventory_unit',
  'customer',
  'consignment_item'
);

create type public.attachment_visibility as enum ('internal', 'customer', 'public');

create type public.attachment_event_type as enum (
  'created',
  'visibility_changed',
  'caption_changed',
  'deleted'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entity_type public.attachment_entity not null,
  entity_id uuid not null,
  storage_bucket text not null,
  storage_path text not null unique,
  media_type text not null,
  byte_size integer null check (byte_size > 0 and byte_size <= 20971520),
  width integer null check (width between 1 and 100000),
  height integer null check (height between 1 and 100000),
  caption text null check (pg_catalog.char_length(caption) <= 500),
  visibility public.attachment_visibility not null default 'internal',
  -- Null only for rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachments_bucket_matches_visibility check (
    storage_bucket = case when visibility = 'public' then 'media-public' else 'media-internal' end
  ),
  constraint attachments_media_type_check check (
    media_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
  ),
  constraint attachments_path_shape check (
    storage_path ~ (
      '^' || entity_type::text || '/' || entity_id::text || '/' || id::text ||
      '[.](jpg|jpeg|png|webp|heic|heif)$'
    )
  ),
  constraint attachments_extension_matches_media_type check (
    case media_type
      when 'image/jpeg' then storage_path ~ '[.](jpg|jpeg)$'
      when 'image/png' then storage_path ~ '[.]png$'
      when 'image/webp' then storage_path ~ '[.]webp$'
      when 'image/heic' then storage_path ~ '[.]heic$'
      when 'image/heif' then storage_path ~ '[.]heif$'
      else false
    end
  ),
  constraint attachments_customer_never_public check (
    not (entity_type = 'customer' and visibility = 'public')
  )
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id, created_at);
create index attachments_created_by_idx on public.attachments (created_by);

comment on table public.attachments is
  'Photos in Supabase Storage. Created by record_attachment; visibility by set_attachment_visibility; removed by delete_attachment.';

create trigger attachments_set_updated_at
  before update on public.attachments
  for each row execute function private.set_updated_at();

create table public.attachment_events (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: the history outlives a deleted attachment.
  attachment_id uuid not null,
  entity_type public.attachment_entity not null,
  entity_id uuid not null,
  event_type public.attachment_event_type not null,
  -- Null when the change was made outside the app.
  actor_staff_id uuid null references public.staff (id) on delete restrict,
  -- created: the new row's location and fields; visibility_changed and
  -- caption_changed: {"field": {"from", "to"}}; deleted: the removed row.
  payload jsonb not null default '{}'::jsonb,
  reason text null,
  correlation_id text null,
  created_at timestamptz not null default clock_timestamp(),
  constraint attachment_events_deleted_has_reason check (event_type <> 'deleted' or reason is not null),
  constraint attachment_events_reason_check check (
    reason is null or (pg_catalog.btrim(reason) <> '' and pg_catalog.char_length(reason) <= 500)
  )
);
create index attachment_events_entity_idx on public.attachment_events (entity_type, entity_id, created_at desc);
create index attachment_events_attachment_id_idx on public.attachment_events (attachment_id);
create index attachment_events_actor_staff_id_idx on public.attachment_events (actor_staff_id);

comment on table public.attachment_events is
  'Append-only history of attachments: created, visibility_changed, caption_changed, deleted (with reason). Written by triggers.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Does entity_id name an existing row of entity_type? NULL when this
-- database cannot attach to that type yet. EXTENSION POINT: the migration
-- that creates work_orders, products, inventory_units or consignment_items
-- replaces this function with one more branch.
create function private.attachment_entity_exists(entity_type public.attachment_entity, entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  case attachment_entity_exists.entity_type
    when 'customer' then
      return exists (select 1 from public.customers c where c.id = attachment_entity_exists.entity_id);
    when 'bike' then
      return exists (select 1 from public.bikes b where b.id = attachment_entity_exists.entity_id);
    else
      return null;
  end case;
end;
$$;

-- The bucket a visibility lives in.
create function private.attachment_bucket(visibility public.attachment_visibility)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when visibility = 'public' then 'media-public' else 'media-internal' end;
$$;

-- Raises attachment_path_mismatch unless `path` is exactly
-- {entity_type}/{entity_id}/{attachment_id}.{ext} with an extension that
-- matches media_type.
create function private.check_attachment_path(
  attachment_id uuid,
  entity_type public.attachment_entity,
  entity_id uuid,
  media_type text,
  path text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  prefix text := entity_type::text || '/' || entity_id::text || '/' || attachment_id::text || '.';
  ext text;
begin
  if path is null or pg_catalog.left(path, pg_catalog.length(prefix)) <> prefix then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_path_mismatch',
      detail = pg_catalog.format('The object must be stored at %s<extension>.', prefix);
  end if;
  ext := pg_catalog.substr(path, pg_catalog.length(prefix) + 1);
  if not (
    (media_type = 'image/jpeg' and ext in ('jpg', 'jpeg'))
    or (media_type = 'image/png' and ext = 'png')
    or (media_type = 'image/webp' and ext = 'webp')
    or (media_type = 'image/heic' and ext = 'heic')
    or (media_type = 'image/heif' and ext = 'heif')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_path_mismatch',
      detail = pg_catalog.format('The file extension "%s" does not match %s.', ext, media_type);
  end if;
end;
$$;

-- Raises attachment_object_missing unless Storage holds bucket/path. Reads
-- storage.objects as the function owner (the migration role, which bypasses
-- RLS on hosted Supabase and locally), so the caller's own storage access
-- does not matter here. Returns the object's metadata (size, mimetype).
create function private.require_storage_object(bucket text, path text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  meta jsonb;
begin
  select coalesce(o.metadata, '{}'::jsonb) into meta
  from storage.objects o
  where o.bucket_id = require_storage_object.bucket and o.name = require_storage_object.path
  limit 1;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_object_missing',
      detail = 'Upload the file to storage before recording it.';
  end if;
  return meta;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rules every writer obeys, and history.
-- ---------------------------------------------------------------------------
create function private.attachments_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity_exists boolean;
begin
  if tg_op = 'DELETE' then
    if private.change_reason() is null then
      raise exception using
        errcode = 'P0001',
        message = 'reason_required',
        detail = 'Say why this photo is being deleted.';
    end if;
    return old;
  end if;

  new.caption := nullif(pg_catalog.btrim(new.caption), '');

  if tg_op = 'INSERT' then
    entity_exists := private.attachment_entity_exists(new.entity_type, new.entity_id);
    if entity_exists is null then
      raise exception using
        errcode = 'P0001',
        message = 'attachment_entity_unsupported',
        detail = pg_catalog.format('Attachments to %s records are not supported yet.', new.entity_type);
    elsif not entity_exists then
      raise exception '% % not found', new.entity_type, new.entity_id using errcode = 'P0002';
    end if;
  elsif new.id is distinct from old.id
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.media_type is distinct from old.media_type
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_immutable',
      detail = 'An attachment keeps its record, file type and author; record a new one instead.';
  end if;
  return new;
end;
$$;

create trigger attachments_enforce_rules
  before insert or update or delete on public.attachments
  for each row execute function private.attachments_enforce_rules();

create function private.attachments_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.current_staff_id();
  reason text := private.change_reason();
  correlation text := private.current_correlation_id();
begin
  if tg_op = 'INSERT' then
    insert into public.attachment_events
      (attachment_id, entity_type, entity_id, event_type, actor_staff_id, payload, reason, correlation_id)
    values (
      new.id, new.entity_type, new.entity_id, 'created', actor,
      pg_catalog.jsonb_build_object(
        'storage_bucket', new.storage_bucket,
        'storage_path', new.storage_path,
        'media_type', new.media_type,
        'visibility', new.visibility,
        'caption', new.caption
      ),
      reason, correlation
    );
  elsif tg_op = 'UPDATE' then
    if new.visibility is distinct from old.visibility
       or new.storage_bucket is distinct from old.storage_bucket
       or new.storage_path is distinct from old.storage_path then
      insert into public.attachment_events
        (attachment_id, entity_type, entity_id, event_type, actor_staff_id, payload, reason, correlation_id)
      values (
        new.id, new.entity_type, new.entity_id, 'visibility_changed', actor,
        pg_catalog.jsonb_build_object(
          'visibility', pg_catalog.jsonb_build_object('from', old.visibility, 'to', new.visibility),
          'storage_bucket', pg_catalog.jsonb_build_object('from', old.storage_bucket, 'to', new.storage_bucket),
          'storage_path', pg_catalog.jsonb_build_object('from', old.storage_path, 'to', new.storage_path)
        ),
        reason, correlation
      );
    end if;
    if new.caption is distinct from old.caption then
      insert into public.attachment_events
        (attachment_id, entity_type, entity_id, event_type, actor_staff_id, payload, reason, correlation_id)
      values (
        new.id, new.entity_type, new.entity_id, 'caption_changed', actor,
        pg_catalog.jsonb_build_object(
          'caption', pg_catalog.jsonb_build_object('from', old.caption, 'to', new.caption)
        ),
        reason, correlation
      );
    end if;
  else
    insert into public.attachment_events
      (attachment_id, entity_type, entity_id, event_type, actor_staff_id, payload, reason, correlation_id)
    values (
      old.id, old.entity_type, old.entity_id, 'deleted', actor,
      pg_catalog.to_jsonb(old), reason, correlation
    );
  end if;
  return null;
end;
$$;

create trigger attachments_record_history
  after insert or update or delete on public.attachments
  for each row execute function private.attachments_record_history();

create function private.attachment_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'attachment_history_append_only',
    detail = 'Attachment history cannot be changed or deleted.';
end;
$$;

create trigger attachment_events_append_only
  before update or delete on public.attachment_events
  for each row execute function private.attachment_events_append_only();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Active staff. Records an object the client already uploaded to
-- {entity_type}/{entity_id}/{attachment_id}.{ext} in the bucket of
-- `visibility`. The object's own size and mimetype (from Storage) win over
-- what the client says. Replaying the same call returns the same row; an
-- id that was used for something else, or deleted, is refused.
create function public.record_attachment(
  attachment_id uuid,
  entity_type public.attachment_entity,
  entity_id uuid,
  storage_bucket text,
  storage_path text,
  media_type text,
  byte_size integer default null,
  width integer default null,
  height integer default null,
  caption text default null,
  visibility public.attachment_visibility default 'internal'
)
returns public.attachments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  entity_exists boolean;
  meta jsonb;
  object_type text;
  object_size bigint;
  result public.attachments;
begin
  if record_attachment.attachment_id is null or record_attachment.entity_type is null
     or record_attachment.entity_id is null or record_attachment.storage_bucket is null
     or record_attachment.storage_path is null or record_attachment.media_type is null
     or record_attachment.visibility is null then
    raise exception 'attachment_id, entity, bucket, path, media type and visibility are required'
      using errcode = '22004';
  end if;

  -- Replay: the same attachment recorded again returns the existing row.
  select a.* into result from public.attachments a where a.id = record_attachment.attachment_id;
  if found then
    if result.entity_type = record_attachment.entity_type
       and result.entity_id = record_attachment.entity_id
       and result.storage_path = record_attachment.storage_path then
      return result;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'attachment_conflict',
      detail = 'That attachment id is already used for another file.';
  end if;
  if exists (
    select 1 from public.attachment_events e where e.attachment_id = record_attachment.attachment_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_deleted',
      detail = 'That attachment was deleted; upload the photo again as a new attachment.';
  end if;

  entity_exists := private.attachment_entity_exists(record_attachment.entity_type, record_attachment.entity_id);
  if entity_exists is null then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_entity_unsupported',
      detail = pg_catalog.format('Attachments to %s records are not supported yet.', record_attachment.entity_type);
  elsif not entity_exists then
    raise exception '% % not found', record_attachment.entity_type, record_attachment.entity_id
      using errcode = 'P0002';
  end if;

  if record_attachment.media_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_media_type_unsupported',
      detail = 'Photos must be JPEG, PNG, WebP or HEIC.';
  end if;
  if record_attachment.storage_bucket <> private.attachment_bucket(record_attachment.visibility) then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_bucket_mismatch',
      detail = pg_catalog.format('%s attachments are stored in %s.',
        record_attachment.visibility, private.attachment_bucket(record_attachment.visibility));
  end if;
  if record_attachment.visibility = 'public' and record_attachment.entity_type = 'customer' then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_customer_never_public',
      detail = 'Photos on a customer record cannot be made public.';
  end if;
  perform private.check_attachment_path(
    record_attachment.attachment_id, record_attachment.entity_type, record_attachment.entity_id,
    record_attachment.media_type, record_attachment.storage_path
  );

  meta := private.require_storage_object(record_attachment.storage_bucket, record_attachment.storage_path);
  object_type := pg_catalog.lower(nullif(meta ->> 'mimetype', ''));
  if object_type is not null and object_type <> record_attachment.media_type then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_media_type_mismatch',
      detail = pg_catalog.format('The uploaded file is %s, not %s.', object_type, record_attachment.media_type);
  end if;
  if (meta ->> 'size') ~ '^[0-9]{1,12}$' then
    object_size := (meta ->> 'size')::bigint;
  end if;

  insert into public.attachments as a (
    id, entity_type, entity_id, storage_bucket, storage_path, media_type,
    byte_size, width, height, caption, visibility, created_by
  )
  values (
    record_attachment.attachment_id, record_attachment.entity_type, record_attachment.entity_id,
    record_attachment.storage_bucket, record_attachment.storage_path, record_attachment.media_type,
    coalesce(least(object_size, 2147483647)::integer, record_attachment.byte_size),
    record_attachment.width, record_attachment.height, record_attachment.caption,
    record_attachment.visibility, actor
  )
  on conflict (id) do nothing
  returning a.* into result;

  if not found then
    -- A concurrent call with the same id won the insert.
    select a.* into result from public.attachments a where a.id = record_attachment.attachment_id;
    if result.entity_type is distinct from record_attachment.entity_type
       or result.entity_id is distinct from record_attachment.entity_id
       or result.storage_path is distinct from record_attachment.storage_path then
      raise exception using
        errcode = 'P0001',
        message = 'attachment_conflict',
        detail = 'That attachment id is already used for another file.';
    end if;
  end if;
  return result;
end;
$$;

comment on function public.record_attachment(
  uuid, public.attachment_entity, uuid, text, text, text, integer, integer, integer, text, public.attachment_visibility
) is 'Active staff: record a photo already uploaded to {entity_type}/{entity_id}/{attachment_id}.{ext}.';

-- Active staff. Sets who may see an attachment. internal <-> customer stays
-- in media-internal; to or from public the server first copies the object
-- to the other bucket (same path) and passes the new location, which must
-- exist; afterwards it removes the old object. Replaying the current state
-- is a no-op.
create function public.set_attachment_visibility(
  attachment_id uuid,
  visibility public.attachment_visibility,
  new_bucket text default null,
  new_path text default null
)
returns public.attachments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_row public.attachments;
  target_bucket text := private.attachment_bucket(set_attachment_visibility.visibility);
  target_path text;
  result public.attachments;
begin
  perform private.require_staff();

  if set_attachment_visibility.attachment_id is null or set_attachment_visibility.visibility is null then
    raise exception 'attachment_id and visibility are required' using errcode = '22004';
  end if;

  select a.* into current_row
  from public.attachments a
  where a.id = set_attachment_visibility.attachment_id
  for update;
  if not found then
    raise exception 'attachment % not found', set_attachment_visibility.attachment_id using errcode = 'P0002';
  end if;

  if set_attachment_visibility.new_bucket is not null and set_attachment_visibility.new_bucket <> target_bucket then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_bucket_mismatch',
      detail = pg_catalog.format('%s attachments are stored in %s.', set_attachment_visibility.visibility, target_bucket);
  end if;
  target_path := coalesce(set_attachment_visibility.new_path, current_row.storage_path);

  if current_row.visibility = set_attachment_visibility.visibility
     and current_row.storage_bucket = target_bucket
     and current_row.storage_path = target_path then
    return current_row;
  end if;

  if set_attachment_visibility.visibility = 'public' and current_row.entity_type = 'customer' then
    raise exception using
      errcode = 'P0001',
      message = 'attachment_customer_never_public',
      detail = 'Photos on a customer record cannot be made public.';
  end if;
  perform private.check_attachment_path(
    current_row.id, current_row.entity_type, current_row.entity_id, current_row.media_type, target_path
  );
  if target_bucket <> current_row.storage_bucket or target_path <> current_row.storage_path then
    perform private.require_storage_object(target_bucket, target_path);
  end if;

  update public.attachments a
  set visibility = set_attachment_visibility.visibility,
      storage_bucket = target_bucket,
      storage_path = target_path
  where a.id = current_row.id
  returning a.* into result;
  return result;
end;
$$;

comment on function public.set_attachment_visibility(uuid, public.attachment_visibility, text, text) is
  'Active staff: change an attachment''s visibility; a move to or from public names the copied object''s new location.';

-- Active staff. Deletes the row with a mandatory reason; the
-- attachment_events `deleted` row keeps the actor, the reason and the
-- removed row. Returns the removed row (the server then deletes its
-- object), or null when it was already deleted (replay-safe).
create function public.delete_attachment(attachment_id uuid, reason text)
returns public.attachments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(pg_catalog.btrim(coalesce(delete_attachment.reason, '')), '');
  result public.attachments;
begin
  perform private.require_staff();

  if delete_attachment.attachment_id is null then
    raise exception 'attachment_id is required' using errcode = '22004';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why this photo is being deleted.';
  end if;

  perform 1 from public.attachments a where a.id = delete_attachment.attachment_id for update;
  if not found then
    if exists (
      select 1 from public.attachment_events e
      where e.attachment_id = delete_attachment.attachment_id and e.event_type = 'deleted'
    ) then
      return null;
    end if;
    raise exception 'attachment % not found', delete_attachment.attachment_id using errcode = 'P0002';
  end if;

  perform private.set_change_reason(cleaned);
  delete from public.attachments a
  where a.id = delete_attachment.attachment_id
  returning a.* into result;
  perform private.set_change_reason(null);
  return result;
end;
$$;

comment on function public.delete_attachment(uuid, text) is
  'Active staff: delete an attachment with a reason (kept in attachment_events). The server then removes the object.';

revoke all on function
  private.attachment_entity_exists(public.attachment_entity, uuid),
  private.attachment_bucket(public.attachment_visibility),
  private.check_attachment_path(uuid, public.attachment_entity, uuid, text, text),
  private.require_storage_object(text, text),
  private.attachments_enforce_rules(),
  private.attachments_record_history(),
  private.attachment_events_append_only()
from public, anon, authenticated, service_role;

revoke all on function
  public.record_attachment(
    uuid, public.attachment_entity, uuid, text, text, text, integer, integer, integer, text, public.attachment_visibility
  ),
  public.set_attachment_visibility(uuid, public.attachment_visibility, text, text),
  public.delete_attachment(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.record_attachment(
    uuid, public.attachment_entity, uuid, text, text, text, integer, integer, integer, text, public.attachment_visibility
  ),
  public.set_attachment_visibility(uuid, public.attachment_visibility, text, text),
  public.delete_attachment(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Grants and RLS: active staff only. Rows are created, moved and deleted
-- only by the RPCs above; staff may edit a caption directly.
-- ---------------------------------------------------------------------------
alter table public.attachments enable row level security;
alter table public.attachment_events enable row level security;

revoke all on table public.attachments from public, anon, authenticated, service_role;
revoke all on table public.attachment_events from public, anon, authenticated, service_role;

grant select on table public.attachments to authenticated;
grant update (caption) on table public.attachments to authenticated;
grant select on table public.attachment_events to authenticated;

grant select on table public.attachments to service_role;
grant select on table public.attachment_events to service_role;

create policy attachments_select_staff on public.attachments
  for select to authenticated
  using ((select private.is_staff()));

create policy attachments_update_staff on public.attachments
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy attachment_events_select_staff on public.attachment_events
  for select to authenticated
  using ((select private.is_staff()));
