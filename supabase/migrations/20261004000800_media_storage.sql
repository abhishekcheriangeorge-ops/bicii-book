-- Photo storage buckets and their access rules (SPEC §8 "Storage policies
-- must enforce visibility"; DATA-MODEL.md §2 "Attachment storage").
--
-- Rules encoded here:
--   * media-internal (private): active staff read and write. Nobody else,
--     ever: not anonymous visitors, not signed-in customers. Customers get
--     short-lived signed URLs minted on a server for `customer` attachments
--     they are entitled to (my_bike_attachments), never a policy.
--   * media-public (public bucket): files are served to anyone at their
--     public URL (/object/public/..., which Storage serves without RLS);
--     nobody but active staff may list or read the bucket through the API,
--     so a public URL is the only way in. It holds only objects of `public`
--     attachments.
--   * Nobody overwrites an object (no UPDATE policy: uploads never upsert,
--     a move copies to a new bucket). Staff delete only objects no
--     attachment row points at; those DELETE policies are in the
--     attachments migration, which creates the table they consult. So a
--     recorded photo leaves Storage only through delete_attachment (reason,
--     history) or a visibility move, never by a bare Storage call.
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
-- which `authenticated` may execute.

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
-- media-internal: active staff read and add.
-- ---------------------------------------------------------------------------
create policy media_internal_select_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'media-internal' and (select private.is_staff()));

create policy media_internal_insert_staff on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media-internal' and (select private.is_staff()));

-- ---------------------------------------------------------------------------
-- media-public: public URLs for everyone (no policy needed); active staff
-- read (copy, remove) and add. No anonymous SELECT: it would let anyone
-- list the bucket.
-- ---------------------------------------------------------------------------
create policy media_public_select_staff on storage.objects
  for select to authenticated
  using (bucket_id = 'media-public' and (select private.is_staff()));

create policy media_public_insert_staff on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media-public' and (select private.is_staff()));
