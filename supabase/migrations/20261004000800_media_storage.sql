-- Photo storage buckets and their access rules (SPEC §8 "Storage policies
-- must enforce visibility"; DATA-MODEL.md §2 "Attachment storage").
--
-- Rules encoded here:
--   * media-internal (private): active staff read and write. Nobody else,
--     ever: not anonymous visitors, not signed-in customers. Customers get
--     short-lived signed URLs minted on a server for `customer` attachments
--     they are entitled to (my_bike_attachments), never a policy.
--   * media-public (public bucket): anyone may read; only active staff
--     write. It holds only objects of `public` attachments.
--   * Both take photos only (JPEG, PNG, WebP, HEIC/HEIF) up to 20 MiB,
--     enforced by Storage itself from the bucket settings.
--   * Object names are `{entity_type}/{entity_id}/{attachment_id}.{ext}`;
--     record_attachment checks that shape (attachments migration).
--
-- Portability: buckets are rows in storage.buckets and access rules are
-- RLS policies on storage.objects, both created here by the role running
-- migrations (postgres on hosted Supabase, where the storage schema is
-- owned by supabase_storage_admin and postgres may still insert buckets and
-- create policies on storage.objects). `on conflict do nothing` keeps a
-- bucket someone already made by hand. The policies call private.is_staff(),
-- which `authenticated` may execute; anonymous policies call nothing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'media-internal', 'media-internal', false, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  ),
  (
    'media-public', 'media-public', true, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- media-internal: active staff only, for every operation.
-- ---------------------------------------------------------------------------
create policy media_internal_select_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'media-internal' and (select private.is_staff()));

create policy media_internal_insert_staff on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media-internal' and (select private.is_staff()));

create policy media_internal_update_staff on storage.objects
  for update to authenticated
  using (bucket_id = 'media-internal' and (select private.is_staff()))
  with check (bucket_id = 'media-internal' and (select private.is_staff()));

create policy media_internal_delete_staff on storage.objects
  for delete to authenticated
  using (bucket_id = 'media-internal' and (select private.is_staff()));

-- ---------------------------------------------------------------------------
-- media-public: everyone reads; active staff write.
-- ---------------------------------------------------------------------------
create policy media_public_select_everyone on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'media-public');

create policy media_public_insert_staff on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media-public' and (select private.is_staff()));

create policy media_public_update_staff on storage.objects
  for update to authenticated
  using (bucket_id = 'media-public' and (select private.is_staff()))
  with check (bucket_id = 'media-public' and (select private.is_staff()));

create policy media_public_delete_staff on storage.objects
  for delete to authenticated
  using (bucket_id = 'media-public' and (select private.is_staff()));
