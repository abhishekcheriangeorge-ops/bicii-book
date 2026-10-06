-- QR identity and label printing (SPEC §2 "Financial snapshots", §15, §16,
-- §23 "Archived entities remain available to historical references", §31
-- "print QR labels ... in arbitrary quantity"; DATA-MODEL.md §11, §12, §15,
-- §16; PLAN D9, D24 (amended), D56 LABEL-QUANTITY, D57 UNIQUE-LABELS, D58
-- LABEL-PRICE, D59 PRINT-CONFIRMED; ADR-017).
--
-- Rules encoded here, for every writer (RPC, seed, SQL editor):
--   * D9 (decided here): the QR payload is exactly
--     {shop_settings.public_site_url}/q/{short_id} and nothing else.
--     private.qr_payload is its only source for printing; it has NO
--     fallback: a missing, null or malformed address raises
--     public_site_url_invalid and nothing prints until an admin sets it.
--     The column check is tightened to exactly what qr_payload accepts
--     (http(s), a host, an optional path, no query or fragment).
--   * private.label_content is the ONLY source of label text. A label
--     carries a subset of reporting.public_items' fields (name, brand,
--     price, currency and a unit's condition) plus identifiers (short ID,
--     SKU, a bike's size/colour line, serial number). Never a cost,
--     yield, Cult Commons, consignor, ownership, owner name or internal
--     note: it never reads those columns, and print_jobs_content_keys is
--     the database whitelist of content keys.
--   * D58: the printed price is exactly private.selling_price(product,
--     unit) (the function public_items, the sale default and Shopify use),
--     2 decimals; NULL prints no price line, 0 prints 0.00 (D24 as
--     amended: 0 is a known price). The price is a snapshot.
--   * D57: unique-tracked products are labelled per unit (U-); a P- label
--     for a unique product is refused (label_unique_product_needs_unit).
--     A unit linked to a bike shows the bike's size/colour line. Any
--     non-archived bike may get a tag (B-). Archived records cannot get a
--     new label (label_entity_archived), but their old jobs stay readable.
--   * D56: one job prints 1-500 labels of a quantity product or 1-10 of a
--     unit or bike; more labels = another job.
--   * D59: a job is queued, then rendered for printing, then confirmed
--     printed or failed (with the reason) by staff; printed and failed are
--     final (private.print_job_transition_allowed). "Print again" is a new
--     job linked by reprint_of_id.
--   * print_jobs keep three typed foreign keys (product, unit, bike: one per
--     kind), the content, template and printer snapshots, are written only
--     by create_print_job and set_print_job_status, change only in their
--     status columns (print_job_immutable) and are never deleted.
--   * Templates and printer profiles: every active staff member reads
--     them; admins insert and edit them (column grants: never is_default
--     or created_by); exactly one default template per kind and one
--     default profile, moved only by set_default_label_template /
--     set_default_printer_profile; the default cannot be switched off.
--     A template's kind and a profile's adapter never change. Layout v1
--     and printer config v1 are validated by private.label_layout_problem
--     and private.printer_config_problem for every writer.
--   * Adapters: browser and pdf only; network_raw and bluetooth exist for
--     Phase 12 and printer_profiles_adapter_available keeps them unusable.
--   * Built-in rows (production needs them): a 58 x 40 mm default template
--     per kind and the browser and PDF profiles (browser is the default).
--   * Customers and anonymous visitors read nothing here. No anonymous
--     function is added: the public row of a scanned label is
--     reporting.public_items (unchanged).
--
-- LOCK ORDER: create_print_job takes the printer profile then the
-- template FOR SHARE, then inserts its own row (on conflict (id) do
-- nothing); set_default_* lock every row of the set FOR UPDATE in id
-- order; set_print_job_status locks only its job.
--
-- Idempotency: create_print_job by job id (the client's id; a replay with
-- the same kind, record and quantity returns the job, anything else is
-- print_job_conflict); set_print_job_status to the current status is a
-- no-op; set_default_* to the current default is a no-op.

-- ---------------------------------------------------------------------------
-- D9: the QR base. The column now accepts exactly what private.qr_payload
-- accepts.
-- ---------------------------------------------------------------------------
alter table public.shop_settings drop constraint shop_settings_public_site_url_check;
alter table public.shop_settings
  add constraint shop_settings_public_site_url_check check (
    public_site_url ~ '^https?://[^/?#[:space:]]+(/[^?#[:space:]]*)?$'
    and pg_catalog.char_length(public_site_url) <= 200
  );

comment on column public.shop_settings.public_site_url is
  'The QR base (D9, Phase 8): labels encode {public_site_url}/q/{short_id}; no fallback. http(s), a host and an optional path, no query or fragment; null stops printing (public_site_url_invalid).';

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.label_kind as enum ('product', 'unit', 'bike');
comment on type public.label_kind is
  'What a label identifies: a product (P-), an inventory unit (U-) or a bike (B-).';

create type public.printer_adapter as enum ('browser', 'pdf', 'network_raw', 'bluetooth');
comment on type public.printer_adapter is
  'How labels reach paper. browser and pdf only; network_raw and bluetooth are reserved for Phase 12 (printer_profiles_adapter_available).';

create type public.print_status as enum ('queued', 'rendered', 'printed', 'failed');
comment on type public.print_status is
  'D59: queued -> rendered -> printed | failed (confirmed by staff); printed and failed are final.';

create domain public.label_mm as numeric(5, 1)
  constraint label_mm_not_nan check (value <> 'NaN'::numeric);
comment on domain public.label_mm is
  'A label dimension in millimetres, one decimal. Never NaN; tables add their own range checks.';

-- ---------------------------------------------------------------------------
-- Validation helpers (pure; used by the triggers for every writer)
-- ---------------------------------------------------------------------------

-- Layout v1: exactly the keys version (1), qr_mm, padding_mm (0.5..6),
-- qr_position (left|right), fields (1..6 distinct of name, price,
-- short_id, sku, identity, serial_number; must include short_id),
-- name_lines (1..3) and text_mm (1.8..6); the QR code is at least 10 mm
-- and fits the label inside its margins, and the text column beside it
-- is at least 15 mm wide. Returns null when valid, else one sentence
-- about the first problem. Never raises on a malformed shape.
create function private.label_layout_problem(layout jsonb, width_mm numeric, height_mm numeric)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  allowed_keys constant text[] := array[
    'version', 'qr_mm', 'padding_mm', 'qr_position', 'fields', 'name_lines', 'text_mm'
  ];
  allowed_fields constant text[] := array['name', 'price', 'short_id', 'sku', 'identity', 'serial_number'];
  numeric_keys constant text[] := array['version', 'qr_mm', 'padding_mm', 'name_lines', 'text_mm'];
  k text;
  f jsonb;
  seen text[] := '{}';
  qr numeric;
  pad numeric;
  lines numeric;
  txt numeric;
  max_qr numeric;
begin
  if layout is null or pg_catalog.jsonb_typeof(layout) <> 'object' then
    return 'The layout must be a JSON object.';
  end if;
  if width_mm is null or height_mm is null then
    return 'The label needs a width and a height.';
  end if;
  for k in select pg_catalog.jsonb_object_keys(layout) loop
    if not (k = any (allowed_keys)) then
      return pg_catalog.format('Unknown layout setting "%s".', k);
    end if;
  end loop;
  foreach k in array allowed_keys loop
    if not (layout ? k) then
      return pg_catalog.format('The layout is missing "%s".', k);
    end if;
  end loop;
  foreach k in array numeric_keys loop
    if pg_catalog.jsonb_typeof(layout -> k) <> 'number' then
      return pg_catalog.format('"%s" must be a number.', k);
    end if;
  end loop;

  if (layout ->> 'version')::numeric <> 1 then
    return 'Only layout version 1 is supported.';
  end if;

  qr := (layout ->> 'qr_mm')::numeric;
  pad := (layout ->> 'padding_mm')::numeric;
  lines := (layout ->> 'name_lines')::numeric;
  txt := (layout ->> 'text_mm')::numeric;

  if pad < 0.5 or pad > 6 then
    return 'The margin is 0.5 to 6 mm.';
  end if;
  if pg_catalog.jsonb_typeof(layout -> 'qr_position') <> 'string'
     or (layout ->> 'qr_position') not in ('left', 'right') then
    return 'The QR code goes on the left or the right.';
  end if;
  if lines <> pg_catalog.trunc(lines) or lines < 1 or lines > 3 then
    return 'The name takes 1 to 3 lines.';
  end if;
  if txt < 1.8 or txt > 6 then
    return 'The text size is 1.8 to 6 mm.';
  end if;

  if pg_catalog.jsonb_typeof(layout -> 'fields') <> 'array'
     or pg_catalog.jsonb_array_length(layout -> 'fields') not between 1 and 6 then
    return 'The fields must be a list of 1 to 6 fields.';
  end if;
  for f in select e from pg_catalog.jsonb_array_elements(layout -> 'fields') e loop
    if pg_catalog.jsonb_typeof(f) <> 'string' then
      return 'Each field must be a field name.';
    end if;
    if not ((f #>> '{}') = any (allowed_fields)) then
      return pg_catalog.format('Unknown field "%s".', f #>> '{}');
    end if;
    if (f #>> '{}') = any (seen) then
      return pg_catalog.format('The field "%s" is listed twice.', f #>> '{}');
    end if;
    seen := seen || (f #>> '{}');
  end loop;
  if not ('short_id' = any (seen)) then
    return 'Every label must show its short ID.';
  end if;

  if qr < 10 then
    return 'The QR code must be at least 10 mm to scan.';
  end if;
  max_qr := least(width_mm, height_mm) - 2 * pad;
  if qr > max_qr then
    return pg_catalog.format(
      'The QR code does not fit: at most %s mm on this label.',
      pg_catalog.to_char(greatest(max_qr, 0), 'FM9990.0')
    );
  end if;
  if width_mm - qr - 3 * pad < 15 then
    return 'The text beside the QR code needs at least 15 mm: make the QR code smaller or the label wider.';
  end if;
  return null;
end;
$$;

comment on function private.label_layout_problem(jsonb, numeric, numeric) is
  'Layout v1 validation (DATA-MODEL §12): null when the layout fits a width x height label, else one sentence about the first problem.';

-- Printer config v1 (browser, pdf): an object whose only keys are
-- offset_x_mm and offset_y_mm, each optional, a number from -5 to 5.
create function private.printer_config_problem(adapter public.printer_adapter, config jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
begin
  if config is null or pg_catalog.jsonb_typeof(config) <> 'object' then
    return 'Printer settings must be a JSON object.';
  end if;
  for k in select pg_catalog.jsonb_object_keys(config) loop
    if k not in ('offset_x_mm', 'offset_y_mm') then
      return pg_catalog.format('Unknown printer setting "%s".', k);
    end if;
    if pg_catalog.jsonb_typeof(config -> k) <> 'number'
       or (config ->> k)::numeric < -5 or (config ->> k)::numeric > 5 then
      return 'Print offsets are numbers from -5 to 5 mm.';
    end if;
  end loop;
  return null;
end;
$$;

comment on function private.printer_config_problem(public.printer_adapter, jsonb) is
  'Printer config v1 validation (DATA-MODEL §12): null when valid, else one sentence about the first problem. Phase 12 adds its adapter''s settings here.';

-- ---------------------------------------------------------------------------
-- label_templates
-- ---------------------------------------------------------------------------
create table public.label_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.label_kind not null,
  width_mm public.label_mm not null,
  height_mm public.label_mm not null,
  layout jsonb not null,
  is_default boolean not null default false,
  active boolean not null default true,
  -- Null for the built-in rows and rows created outside the app.
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint label_templates_name_key unique (name),
  constraint label_templates_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 80
  ),
  constraint label_templates_width_mm_check check (width_mm between 20 and 150),
  constraint label_templates_height_mm_check check (height_mm between 15 and 150),
  constraint label_templates_default_is_active check (not is_default or active)
);
create unique index label_templates_one_default_per_kind on public.label_templates (kind) where is_default;
create index label_templates_created_by_idx on public.label_templates (created_by);

comment on table public.label_templates is
  'Label layouts (layout v1, DATA-MODEL §12). Staff read; admins insert and edit; one default per kind, moved by set_default_label_template. Never deleted (switch off).';
comment on column public.label_templates.layout is
  'Layout v1: {version 1, qr_mm, padding_mm, qr_position, fields, name_lines, text_mm}; validated by private.label_layout_problem.';

create trigger label_templates_set_updated_at
  before update on public.label_templates
  for each row execute function private.set_updated_at();

create function private.label_templates_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  problem text;
begin
  new.name := pg_catalog.btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(private.current_staff_id(), new.created_by);
  elsif new.kind is distinct from old.kind then
    raise exception using
      errcode = 'P0001',
      message = 'label_template_kind_immutable',
      detail = 'A template keeps its label kind; create a new template instead.';
  end if;
  problem := private.label_layout_problem(new.layout, new.width_mm, new.height_mm);
  if problem is not null then
    raise exception using
      errcode = 'P0001',
      message = 'label_layout_invalid',
      detail = problem;
  end if;
  if new.is_default and not new.active then
    raise exception using
      errcode = 'P0001',
      message = 'label_template_default_required',
      detail = 'Make another template the default for this kind before switching this one off.';
  end if;
  return new;
end;
$$;

create trigger label_templates_enforce_rules
  before insert or update on public.label_templates
  for each row execute function private.label_templates_enforce_rules();

-- ---------------------------------------------------------------------------
-- printer_profiles
-- ---------------------------------------------------------------------------
create table public.printer_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  adapter public.printer_adapter not null,
  config jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid null references public.staff (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint printer_profiles_name_key unique (name),
  constraint printer_profiles_name_check check (
    pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 80
  ),
  constraint printer_profiles_default_is_active check (not is_default or active),
  constraint printer_profiles_adapter_available check (adapter in ('browser', 'pdf'))
);
create unique index printer_profiles_one_default on public.printer_profiles ((true)) where is_default;
create index printer_profiles_created_by_idx on public.printer_profiles (created_by);

comment on table public.printer_profiles is
  'Where labels go (adapter + config v1). Staff read; admins insert and edit; one default overall, moved by set_default_printer_profile. Never deleted (switch off). A profile carries no template.';
comment on constraint printer_profiles_adapter_available on public.printer_profiles is
  'Phase 12 replaces this when a hardware adapter ships.';
comment on column public.printer_profiles.config is
  'Config v1: {offset_x_mm?, offset_y_mm?} in -5..5; validated by private.printer_config_problem.';

create trigger printer_profiles_set_updated_at
  before update on public.printer_profiles
  for each row execute function private.set_updated_at();

create function private.printer_profiles_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  problem text;
begin
  new.name := pg_catalog.btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(private.current_staff_id(), new.created_by);
  elsif new.adapter is distinct from old.adapter then
    raise exception using
      errcode = 'P0001',
      message = 'printer_profile_adapter_immutable',
      detail = 'A printer keeps its type; add a new printer instead.';
  end if;
  problem := private.printer_config_problem(new.adapter, new.config);
  if problem is not null then
    raise exception using
      errcode = 'P0001',
      message = 'printer_config_invalid',
      detail = problem;
  end if;
  if new.is_default and not new.active then
    raise exception using
      errcode = 'P0001',
      message = 'printer_profile_default_required',
      detail = 'Make another printer the default before switching this one off.';
  end if;
  return new;
end;
$$;

create trigger printer_profiles_enforce_rules
  before insert or update on public.printer_profiles
  for each row execute function private.printer_profiles_enforce_rules();

-- ---------------------------------------------------------------------------
-- print_jobs
-- ---------------------------------------------------------------------------
create table public.print_jobs (
  -- Client-supplied: the idempotency key of create_print_job.
  id uuid primary key default gen_random_uuid(),
  label_kind public.label_kind not null,
  product_id uuid null references public.products (id) on delete restrict,
  inventory_unit_id uuid null references public.inventory_units (id) on delete restrict,
  bike_id uuid null references public.bikes (id) on delete restrict,
  short_id text not null,
  qr_payload text not null,
  -- private.label_content at creation: the snapshot every copy prints.
  content jsonb not null,
  quantity integer not null,
  printer_profile_id uuid not null references public.printer_profiles (id) on delete restrict,
  -- {name, adapter, config} at creation.
  profile_snapshot jsonb not null,
  adapter public.printer_adapter not null,
  label_template_id uuid not null references public.label_templates (id) on delete restrict,
  -- {name, kind, width_mm, height_mm, layout} at creation.
  template_snapshot jsonb not null,
  status public.print_status not null default 'queued',
  rendered_at timestamptz null,
  completed_at timestamptz null,
  error text null,
  status_changed_by uuid null references public.staff (id) on delete restrict,
  reprint_of_id uuid null references public.print_jobs (id) on delete restrict,
  requested_by uuid not null references public.staff (id) on delete restrict,
  correlation_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_jobs_entity_matches_kind check (
    (label_kind = 'product') = (product_id is not null)
    and (label_kind = 'unit') = (inventory_unit_id is not null)
    and (label_kind = 'bike') = (bike_id is not null)
  ),
  constraint print_jobs_qr_payload_shape check (
    qr_payload ~ '^https?://[^?#[:space:]]+/q/(B|P|U)-[0-9]{6}$'
    and pg_catalog.right(qr_payload, pg_catalog.char_length(short_id) + 3) = '/q/' || short_id
    and content ->> 'qr_payload' = qr_payload
    and content ->> 'short_id' = short_id
  ),
  constraint print_jobs_content_keys check (
    pg_catalog.jsonb_typeof(content) = 'object'
    and content - array[
      'kind', 'short_id', 'qr_payload', 'name', 'price', 'currency', 'sku', 'identity', 'serial_number'
    ] = '{}'::jsonb
  ),
  constraint print_jobs_quantity_check check (quantity between 1 and 500),
  constraint print_jobs_unique_quantity_check check (label_kind = 'product' or quantity <= 10),
  constraint print_jobs_error_check check (
    (status = 'failed') = (error is not null)
    and (error is null or (pg_catalog.btrim(error) <> '' and pg_catalog.char_length(error) <= 500))
  ),
  constraint print_jobs_completed_check check (
    (status in ('printed', 'failed')) = (completed_at is not null)
  ),
  constraint print_jobs_rendered_check check (status <> 'queued' or rendered_at is null)
);
create index print_jobs_created_at_idx on public.print_jobs (created_at desc);
create index print_jobs_product_id_idx on public.print_jobs (product_id, created_at desc);
create index print_jobs_inventory_unit_id_idx on public.print_jobs (inventory_unit_id, created_at desc);
create index print_jobs_bike_id_idx on public.print_jobs (bike_id, created_at desc);
create index print_jobs_requested_by_idx on public.print_jobs (requested_by);
create index print_jobs_reprint_of_id_idx on public.print_jobs (reprint_of_id);
create index print_jobs_printer_profile_id_idx on public.print_jobs (printer_profile_id);
create index print_jobs_label_template_id_idx on public.print_jobs (label_template_id);
create index print_jobs_status_changed_by_idx on public.print_jobs (status_changed_by);
create index print_jobs_open_idx on public.print_jobs (created_at desc) where status in ('queued', 'rendered');

comment on table public.print_jobs is
  'One print request: N identical labels of one product, unit or bike, with the content, template and printer snapshots. Written only by create_print_job and set_print_job_status; never deleted (D59).';
comment on column public.print_jobs.content is
  'private.label_content at creation (keys whitelisted by print_jobs_content_keys); never a cost, consignor, ownership or note.';

-- D59: queued -> rendered | printed | failed; rendered -> printed | failed.
create function private.print_job_transition_allowed(from_status public.print_status, to_status public.print_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (from_status, to_status) in (
    ('queued'::public.print_status, 'rendered'::public.print_status),
    ('queued', 'printed'),
    ('rendered', 'printed'),
    ('queued', 'failed'),
    ('rendered', 'failed')
  );
$$;

comment on function private.print_job_transition_allowed(public.print_status, public.print_status) is
  'D59: the print job status machine (queued -> rendered, printed, failed; rendered -> printed, failed).';

create trigger print_jobs_set_updated_at
  before update on public.print_jobs
  for each row execute function private.set_updated_at();

create function private.print_jobs_enforce_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  status_columns constant text[] := array[
    'status', 'rendered_at', 'completed_at', 'error', 'status_changed_by', 'updated_at'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'print_job_immutable',
      detail = 'Print jobs are history and are never deleted.';
  end if;
  if (pg_catalog.to_jsonb(new) - status_columns) is distinct from (pg_catalog.to_jsonb(old) - status_columns) then
    raise exception using
      errcode = 'P0001',
      message = 'print_job_immutable',
      detail = 'Only a print job''s status can change; start a new job instead.';
  end if;
  if new.status is distinct from old.status
     and not private.print_job_transition_allowed(old.status, new.status) then
    raise exception using
      errcode = 'P0001',
      message = 'print_job_transition_invalid',
      detail = pg_catalog.format('A print job cannot go from %s to %s.', old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger print_jobs_enforce_rules
  before update or delete on public.print_jobs
  for each row execute function private.print_jobs_enforce_rules();

-- ---------------------------------------------------------------------------
-- The QR payload and the label text (the only sources)
-- ---------------------------------------------------------------------------

-- D9: {public_site_url}/q/{short_id}, one slash before q. No fallback.
create function private.qr_payload(short_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base text;
begin
  if short_id is null or short_id !~ '^(PO|B|J|P|U|C|S)-[0-9]{6}$' then
    raise exception 'not a short id: %', coalesce(short_id, '(null)') using errcode = '22023';
  end if;
  select s.public_site_url into base from public.shop_settings s where s.id = 1;
  if base is null
     or base !~ '^https?://[^/?#[:space:]]+(/[^?#[:space:]]*)?$'
     or pg_catalog.char_length(base) > 200 then
    raise exception using
      errcode = 'P0001',
      message = 'public_site_url_invalid',
      detail = 'the shop settings web address is missing or is not an http(s) URL';
  end if;
  return pg_catalog.rtrim(base, '/') || '/q/' || short_id;
end;
$$;

comment on function private.qr_payload(text) is
  'D9: the QR payload {shop_settings.public_site_url}/q/{short_id}; public_site_url_invalid when the address is missing or malformed (no fallback).';

-- The label text (DATA-MODEL §12 "Label text"): exactly kind, short_id,
-- qr_payload, name, price, currency, sku, identity (array of lines) and
-- serial_number. Reads names, brands, SKUs, a unit's condition, a bike's
-- size, colour and serial, and the price ONLY through
-- private.selling_price (D58); never a cost, ownership, consignment,
-- customer or note column.
create function private.label_content(kind public.label_kind, entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_short_id text;
  v_name text;
  v_price public.money_amount;
  v_currency text;
  v_sku text;
  v_serial text;
  v_lines text[] := '{}';
  v_line text;
  v_brand text;
  v_condition text;
  v_size text;
  v_colour text;
  v_bike_serial text;
  v_bike_id uuid;
  v_product_id uuid;
  v_tracking public.tracking_type;
  v_product_archived timestamptz;
  v_archived timestamptz;
begin
  if label_content.kind is null or label_content.entity_id is null then
    raise exception 'kind and entity_id are required' using errcode = '22004';
  end if;

  if label_content.kind = 'product' then
    select p.short_id, p.name, p.brand, p.sku, p.currency::text, p.tracking_type, p.archived_at
      into v_short_id, v_name, v_brand, v_sku, v_currency, v_tracking, v_archived
      from public.products p
     where p.id = label_content.entity_id;
    if not found then
      raise exception 'product % not found', label_content.entity_id using errcode = 'P0002';
    end if;
    if v_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'label_entity_archived',
        detail = 'That product is archived.';
    end if;
    if v_tracking = 'unique' then
      raise exception using
        errcode = 'P0001',
        message = 'label_unique_product_needs_unit',
        detail = 'Unique items are labelled per unit (D57).';
    end if;
    v_price := private.selling_price(label_content.entity_id, null);
    v_brand := nullif(pg_catalog.btrim(v_brand), '');
    if v_brand is not null
       and pg_catalog.strpos(pg_catalog.lower(v_name), pg_catalog.lower(v_brand)) = 0 then
      v_lines := v_lines || v_brand;
    end if;

  elsif label_content.kind = 'unit' then
    select u.short_id, u.product_id, u.bike_id, u.serial_number, u.condition, u.archived_at,
           p.name, p.sku, p.currency::text, p.archived_at
      into v_short_id, v_product_id, v_bike_id, v_serial, v_condition, v_archived,
           v_name, v_sku, v_currency, v_product_archived
      from public.inventory_units u
      join public.products p on p.id = u.product_id
     where u.id = label_content.entity_id;
    if not found then
      raise exception 'inventory unit % not found', label_content.entity_id using errcode = 'P0002';
    end if;
    if v_archived is not null or v_product_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'label_entity_archived',
        detail = 'That unit or its product is archived.';
    end if;
    v_price := private.selling_price(v_product_id, label_content.entity_id);
    if v_bike_id is not null then
      select b.frame_size, b.colour, b.serial_number
        into v_size, v_colour, v_bike_serial
        from public.bikes b
       where b.id = v_bike_id;
      v_size := nullif(pg_catalog.btrim(v_size), '');
      v_colour := nullif(pg_catalog.btrim(v_colour), '');
      if v_size is not null or v_colour is not null then
        v_lines := v_lines || pg_catalog.concat_ws(' · ', 'Size ' || v_size, v_colour);
      end if;
    end if;
    v_condition := nullif(
      pg_catalog.btrim(pg_catalog.split_part(pg_catalog.replace(coalesce(v_condition, ''), E'\r', ''), E'\n', 1)),
      ''
    );
    if v_condition is not null then
      v_lines := v_lines || v_condition;
    end if;
    v_serial := coalesce(nullif(pg_catalog.btrim(v_serial), ''), nullif(pg_catalog.btrim(v_bike_serial), ''));

  else
    select b.short_id, b.archived_at,
           pg_catalog.concat_ws(' ',
             nullif(pg_catalog.btrim(b.brand), ''),
             nullif(pg_catalog.btrim(b.model), ''),
             nullif(pg_catalog.btrim(b.variant), '')),
           nullif(pg_catalog.btrim(b.frame_size), ''),
           nullif(pg_catalog.btrim(b.colour), ''),
           b.serial_number
      into v_short_id, v_archived, v_name, v_size, v_colour, v_serial
      from public.bikes b
     where b.id = label_content.entity_id;
    if not found then
      raise exception 'bike % not found', label_content.entity_id using errcode = 'P0002';
    end if;
    if v_archived is not null then
      raise exception using
        errcode = 'P0001',
        message = 'label_entity_archived',
        detail = 'That bike is archived.';
    end if;
    v_price := null;
    v_currency := private.shop_currency();
    v_sku := null;
    if v_size is not null or v_colour is not null then
      v_lines := v_lines || pg_catalog.concat_ws(' · ', 'Size ' || v_size, v_colour);
    end if;
    v_serial := nullif(pg_catalog.btrim(v_serial), '');
  end if;

  -- Identity lines: trimmed, at most 80 characters, blanks dropped.
  select coalesce(pg_catalog.array_agg(l.line order by l.n), '{}')
    into v_lines
    from (
      select nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(x.line), 80)), '') as line, x.n
        from pg_catalog.unnest(v_lines) with ordinality as x(line, n)
    ) l
   where l.line is not null;

  return pg_catalog.jsonb_build_object(
    'kind', label_content.kind::text,
    'short_id', v_short_id,
    'qr_payload', private.qr_payload(v_short_id),
    'name', pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(v_name), 120)),
    'price', case when v_price is null then null else pg_catalog.to_char(v_price, 'FM9999999999990.00') end,
    'currency', v_currency,
    'sku', nullif(pg_catalog.btrim(v_sku), ''),
    'identity', pg_catalog.to_jsonb(v_lines),
    'serial_number', nullif(pg_catalog.btrim(v_serial), '')
  );
end;
$$;

comment on function private.label_content(public.label_kind, uuid) is
  'The only source of label text (DATA-MODEL §12): public fields plus identifiers; the price is private.selling_price (D58; NULL -> null, 0 -> 0.00); refuses archived records and P- labels of unique products (D57).';

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Active staff: what a label of this record would print now (the record
-- page's preview). Nothing is written.
create function public.label_preview(kind public.label_kind, entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  return private.label_content(label_preview.kind, label_preview.entity_id);
end;
$$;

comment on function public.label_preview(public.label_kind, uuid) is
  'Active staff: the label content of a product, unit or bike as it would print now (private.label_content).';

-- Active staff: one print job of `quantity` identical labels (D56), with
-- the content, template and printer snapshots. Replay-safe by job id.
create function public.create_print_job(
  job_id uuid,
  kind public.label_kind,
  entity_id uuid,
  quantity integer,
  printer_profile_id uuid default null,
  label_template_id uuid default null,
  reprint_of_id uuid default null
)
returns public.print_jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  existing public.print_jobs;
  result public.print_jobs;
  v_content jsonb;
  v_profile public.printer_profiles;
  v_template public.label_templates;
  original public.print_jobs;
  attempt integer;
begin
  if create_print_job.job_id is null or create_print_job.kind is null
     or create_print_job.entity_id is null or create_print_job.quantity is null then
    raise exception 'job_id, kind, entity_id and quantity are required' using errcode = '22004';
  end if;

  -- Replay: the same job again returns it.
  select j.* into existing from public.print_jobs j where j.id = create_print_job.job_id;
  if found then
    if existing.label_kind = create_print_job.kind
       and create_print_job.entity_id = coalesce(existing.product_id, existing.inventory_unit_id, existing.bike_id)
       and existing.quantity = create_print_job.quantity
       and (create_print_job.printer_profile_id is null or create_print_job.printer_profile_id = existing.printer_profile_id)
       and (create_print_job.label_template_id is null or create_print_job.label_template_id = existing.label_template_id)
       and (create_print_job.reprint_of_id is null or create_print_job.reprint_of_id = existing.reprint_of_id) then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'print_job_conflict',
      detail = 'That print job id was already used with other settings.';
  end if;

  -- D56: a per-job cap.
  if create_print_job.quantity < 1
     or (create_print_job.kind = 'product' and create_print_job.quantity > 500)
     or (create_print_job.kind <> 'product' and create_print_job.quantity > 10) then
    raise exception using
      errcode = 'P0001',
      message = 'label_quantity_out_of_range',
      detail = 'One job prints 1 to 500 labels of a product, or 1 to 10 of a unit or bike.';
  end if;

  v_content := private.label_content(create_print_job.kind, create_print_job.entity_id);

  -- The printer: the one named, else the default. A retry in a new
  -- statement covers a default moved by a concurrent set_default.
  for attempt in 1..2 loop
    select pp.* into v_profile
      from public.printer_profiles pp
     where (create_print_job.printer_profile_id is not null and pp.id = create_print_job.printer_profile_id)
        or (create_print_job.printer_profile_id is null and pp.is_default)
     for share;
    exit when found or create_print_job.printer_profile_id is not null;
  end loop;
  if v_profile.id is null then
    raise exception 'printer profile % not found', coalesce(create_print_job.printer_profile_id::text, '(default)')
      using errcode = 'P0002';
  end if;
  if not v_profile.active then
    raise exception using
      errcode = 'P0001',
      message = 'printer_profile_inactive',
      detail = 'That printer is switched off.';
  end if;

  -- The template: the one named, else the default for the kind.
  for attempt in 1..2 loop
    select t.* into v_template
      from public.label_templates t
     where (create_print_job.label_template_id is not null and t.id = create_print_job.label_template_id)
        or (create_print_job.label_template_id is null and t.is_default and t.kind = create_print_job.kind)
     for share;
    exit when found or create_print_job.label_template_id is not null;
  end loop;
  if v_template.id is null then
    if create_print_job.label_template_id is not null then
      raise exception 'label template % not found', create_print_job.label_template_id using errcode = 'P0002';
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'label_template_missing',
      detail = pg_catalog.format('There is no default %s label template.', create_print_job.kind);
  end if;
  if not v_template.active then
    raise exception using
      errcode = 'P0001',
      message = 'label_template_inactive',
      detail = 'That label template is switched off.';
  end if;
  if v_template.kind <> create_print_job.kind then
    raise exception using
      errcode = 'P0001',
      message = 'label_template_kind_mismatch',
      detail = pg_catalog.format('That template is for %s labels, not %s labels.', v_template.kind, create_print_job.kind);
  end if;

  if create_print_job.reprint_of_id is not null then
    select j.* into original from public.print_jobs j where j.id = create_print_job.reprint_of_id;
    if not found then
      raise exception 'print job % not found', create_print_job.reprint_of_id using errcode = 'P0002';
    end if;
    if original.label_kind <> create_print_job.kind
       or coalesce(original.product_id, original.inventory_unit_id, original.bike_id) <> create_print_job.entity_id then
      raise exception using
        errcode = 'P0001',
        message = 'print_job_reprint_mismatch',
        detail = 'A reprint must be for the same record as the job it repeats.';
    end if;
  end if;

  insert into public.print_jobs as j (
    id, label_kind, product_id, inventory_unit_id, bike_id, short_id, qr_payload, content, quantity,
    printer_profile_id, profile_snapshot, adapter, label_template_id, template_snapshot,
    status, reprint_of_id, requested_by, correlation_id
  )
  values (
    create_print_job.job_id,
    create_print_job.kind,
    case when create_print_job.kind = 'product' then create_print_job.entity_id end,
    case when create_print_job.kind = 'unit' then create_print_job.entity_id end,
    case when create_print_job.kind = 'bike' then create_print_job.entity_id end,
    v_content ->> 'short_id',
    v_content ->> 'qr_payload',
    v_content,
    create_print_job.quantity,
    v_profile.id,
    pg_catalog.jsonb_build_object('name', v_profile.name, 'adapter', v_profile.adapter, 'config', v_profile.config),
    v_profile.adapter,
    v_template.id,
    pg_catalog.jsonb_build_object(
      'name', v_template.name, 'kind', v_template.kind, 'width_mm', v_template.width_mm,
      'height_mm', v_template.height_mm, 'layout', v_template.layout
    ),
    'queued',
    create_print_job.reprint_of_id,
    actor,
    private.current_correlation_id()
  )
  on conflict (id) do nothing
  returning j.* into result;

  if not found then
    -- A concurrent call with the same id committed first.
    select j.* into existing from public.print_jobs j where j.id = create_print_job.job_id;
    if existing.label_kind = create_print_job.kind
       and create_print_job.entity_id = coalesce(existing.product_id, existing.inventory_unit_id, existing.bike_id)
       and existing.quantity = create_print_job.quantity
       and (create_print_job.printer_profile_id is null or create_print_job.printer_profile_id = existing.printer_profile_id)
       and (create_print_job.label_template_id is null or create_print_job.label_template_id = existing.label_template_id)
       and (create_print_job.reprint_of_id is null or create_print_job.reprint_of_id = existing.reprint_of_id) then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'print_job_conflict',
      detail = 'That print job id was already used with other settings.';
  end if;
  return result;
end;
$$;

comment on function public.create_print_job(uuid, public.label_kind, uuid, integer, uuid, uuid, uuid) is
  'Active staff: start a print job of 1-500 product labels or 1-10 unit or bike labels (D56) with the label, template and printer snapshots; replay-safe by job id (print_job_conflict otherwise).';

-- Active staff: D59. rendered when the labels were rendered for printing,
-- printed or failed (with what went wrong) when staff confirm. The current
-- status again is a no-op (a failed job keeps its first error).
create function public.set_print_job_status(job_id uuid, status public.print_status, error text default null)
returns public.print_jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  current_row public.print_jobs;
  cleaned text;
  result public.print_jobs;
begin
  if set_print_job_status.job_id is null or set_print_job_status.status is null then
    raise exception 'job_id and status are required' using errcode = '22004';
  end if;

  select j.* into current_row from public.print_jobs j where j.id = set_print_job_status.job_id for update;
  if not found then
    raise exception 'print job % not found', set_print_job_status.job_id using errcode = 'P0002';
  end if;

  if current_row.status = set_print_job_status.status then
    return current_row;
  end if;
  if set_print_job_status.status = 'queued'
     or not private.print_job_transition_allowed(current_row.status, set_print_job_status.status) then
    raise exception using
      errcode = 'P0001',
      message = 'print_job_transition_invalid',
      detail = pg_catalog.format('A %s print job cannot be marked %s.', current_row.status, set_print_job_status.status);
  end if;

  if set_print_job_status.status = 'failed' then
    cleaned := nullif(pg_catalog.btrim(coalesce(set_print_job_status.error, '')), '');
    if cleaned is null then
      raise exception using
        errcode = 'P0001',
        message = 'print_job_error_required',
        detail = 'Say what went wrong with the print.';
    end if;
    if pg_catalog.char_length(cleaned) > 500 then
      raise exception using
        errcode = 'P0001',
        message = 'reason_too_long',
        detail = 'Keep it under 500 characters.';
    end if;
  end if;

  update public.print_jobs j
     set status = set_print_job_status.status,
         rendered_at = case
           when set_print_job_status.status = 'rendered' then pg_catalog.now()
           when set_print_job_status.status = 'printed' then coalesce(j.rendered_at, pg_catalog.now())
           else j.rendered_at
         end,
         completed_at = case
           when set_print_job_status.status in ('printed', 'failed') then pg_catalog.now()
           else j.completed_at
         end,
         error = case when set_print_job_status.status = 'failed' then cleaned else null end,
         status_changed_by = actor
   where j.id = current_row.id
  returning j.* into result;
  return result;
end;
$$;

comment on function public.set_print_job_status(uuid, public.print_status, text) is
  'Active staff (D59): mark a print job rendered, printed, or failed with a reason; printed and failed are final; the current status again is a no-op.';

-- Admin: make a template the default for its kind (clears the previous
-- default first: the partial unique index is not deferrable).
create function public.set_default_label_template(template_id uuid)
returns public.label_templates
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_kind public.label_kind;
  target public.label_templates;
  result public.label_templates;
begin
  perform private.require_admin();
  if set_default_label_template.template_id is null then
    raise exception 'template_id is required' using errcode = '22004';
  end if;

  select t.kind into target_kind from public.label_templates t where t.id = set_default_label_template.template_id;
  if not found then
    raise exception 'label template % not found', set_default_label_template.template_id using errcode = 'P0002';
  end if;

  perform 1 from public.label_templates t where t.kind = target_kind order by t.id for update;
  -- A new statement: sees what a concurrent call committed while we waited.
  select t.* into target from public.label_templates t where t.id = set_default_label_template.template_id;
  if not target.active then
    raise exception using
      errcode = 'P0001',
      message = 'label_template_inactive',
      detail = 'Switch the template on before making it the default.';
  end if;
  if target.is_default then
    return target;
  end if;

  update public.label_templates t
     set is_default = false
   where t.kind = target_kind and t.is_default and t.id <> target.id;
  update public.label_templates t
     set is_default = true
   where t.id = target.id
  returning t.* into result;
  return result;
end;
$$;

comment on function public.set_default_label_template(uuid) is
  'Admin: make an active template the default for its kind (exactly one default per kind).';

-- Admin: make a printer profile the default (one default overall).
create function public.set_default_printer_profile(profile_id uuid)
returns public.printer_profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.printer_profiles;
  result public.printer_profiles;
begin
  perform private.require_admin();
  if set_default_printer_profile.profile_id is null then
    raise exception 'profile_id is required' using errcode = '22004';
  end if;

  perform 1 from public.printer_profiles p where p.id = set_default_printer_profile.profile_id;
  if not found then
    raise exception 'printer profile % not found', set_default_printer_profile.profile_id using errcode = 'P0002';
  end if;

  perform 1 from public.printer_profiles p order by p.id for update;
  select p.* into target from public.printer_profiles p where p.id = set_default_printer_profile.profile_id;
  if not target.active then
    raise exception using
      errcode = 'P0001',
      message = 'printer_profile_inactive',
      detail = 'Switch the printer on before making it the default.';
  end if;
  if target.is_default then
    return target;
  end if;

  update public.printer_profiles p
     set is_default = false
   where p.is_default and p.id <> target.id;
  update public.printer_profiles p
     set is_default = true
   where p.id = target.id
  returning p.* into result;
  return result;
end;
$$;

comment on function public.set_default_printer_profile(uuid) is
  'Admin: make an active printer profile the default (exactly one default).';

-- ---------------------------------------------------------------------------
-- Built-in rows (production needs them): 58 x 40 mm templates, one default
-- per kind, fields in the canonical order; the browser (default) and PDF
-- profiles.
-- ---------------------------------------------------------------------------
insert into public.label_templates (id, name, kind, width_mm, height_mm, layout, is_default, active)
values
  ('1ab00000-0000-4000-8000-000000000001', 'Product 58 × 40', 'product', 58, 40,
   '{"version": 1, "qr_mm": 28, "padding_mm": 2, "qr_position": "left", "name_lines": 2, "text_mm": 3,
     "fields": ["name", "price", "short_id", "sku"]}'::jsonb, true, true),
  ('1ab00000-0000-4000-8000-000000000002', 'Unit 58 × 40', 'unit', 58, 40,
   '{"version": 1, "qr_mm": 28, "padding_mm": 2, "qr_position": "left", "name_lines": 2, "text_mm": 3,
     "fields": ["name", "identity", "price", "short_id"]}'::jsonb, true, true),
  ('1ab00000-0000-4000-8000-000000000003', 'Bike tag 58 × 40', 'bike', 58, 40,
   '{"version": 1, "qr_mm": 28, "padding_mm": 2, "qr_position": "left", "name_lines": 2, "text_mm": 3,
     "fields": ["name", "identity", "serial_number", "short_id"]}'::jsonb, true, true)
on conflict (id) do nothing;

insert into public.printer_profiles (id, name, adapter, config, is_default, active, sort_order)
values
  ('a8000000-0000-4000-8000-000000000001', 'This device (browser print)', 'browser', '{}'::jsonb, true, true, 0),
  ('a8000000-0000-4000-8000-000000000002', 'PDF download', 'pdf', '{}'::jsonb, false, true, 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on function
  private.label_layout_problem(jsonb, numeric, numeric),
  private.printer_config_problem(public.printer_adapter, jsonb),
  private.label_templates_enforce_rules(),
  private.printer_profiles_enforce_rules(),
  private.print_job_transition_allowed(public.print_status, public.print_status),
  private.print_jobs_enforce_rules(),
  private.qr_payload(text),
  private.label_content(public.label_kind, uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.label_preview(public.label_kind, uuid),
  public.create_print_job(uuid, public.label_kind, uuid, integer, uuid, uuid, uuid),
  public.set_print_job_status(uuid, public.print_status, text),
  public.set_default_label_template(uuid),
  public.set_default_printer_profile(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.label_preview(public.label_kind, uuid),
  public.create_print_job(uuid, public.label_kind, uuid, integer, uuid, uuid, uuid),
  public.set_print_job_status(uuid, public.print_status, text),
  public.set_default_label_template(uuid),
  public.set_default_printer_profile(uuid)
to authenticated;

alter table public.label_templates enable row level security;
alter table public.printer_profiles enable row level security;
alter table public.print_jobs enable row level security;

revoke all on table public.label_templates from public, anon, authenticated, service_role;
revoke all on table public.printer_profiles from public, anon, authenticated, service_role;
revoke all on table public.print_jobs from public, anon, authenticated, service_role;

-- Templates and profiles: staff read; admins insert and edit through
-- column grants (never is_default, moved by the RPCs, or created_by); no
-- delete for anyone (switch off instead).
grant select on table public.label_templates to authenticated, service_role;
grant insert (id, name, kind, width_mm, height_mm, layout, active) on table public.label_templates to authenticated;
grant update (name, width_mm, height_mm, layout, active) on table public.label_templates to authenticated;

grant select on table public.printer_profiles to authenticated, service_role;
grant insert (id, name, adapter, config, active, sort_order) on table public.printer_profiles to authenticated;
grant update (name, config, active, sort_order) on table public.printer_profiles to authenticated;

-- Print jobs: read-only; written only by the RPCs above.
grant select on table public.print_jobs to authenticated, service_role;

create policy label_templates_select_staff on public.label_templates
  for select to authenticated
  using ((select private.is_staff()));

create policy label_templates_insert_admin on public.label_templates
  for insert to authenticated
  with check ((select private.is_admin()));

create policy label_templates_update_admin on public.label_templates
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy printer_profiles_select_staff on public.printer_profiles
  for select to authenticated
  using ((select private.is_staff()));

create policy printer_profiles_insert_admin on public.printer_profiles
  for insert to authenticated
  with check ((select private.is_admin()));

create policy printer_profiles_update_admin on public.printer_profiles
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy print_jobs_select_staff on public.print_jobs
  for select to authenticated
  using ((select private.is_staff()));
