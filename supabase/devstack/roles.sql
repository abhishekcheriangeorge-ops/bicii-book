-- Devstack bootstrap for PLAIN Postgres only.
--
-- Hosted Supabase and `supabase start` already have every role, schema and
-- grant below; this file recreates just enough of that platform layer so
-- Supabase Auth, Supabase Storage and PostgREST run unmodified against a
-- stock Postgres 16. It must NEVER be copied into supabase/migrations.
--
-- Our own migrations do not rely on anything here beyond the existence of
-- the roles: every migration revokes and grants per object explicitly. To
-- prove that, this file also recreates hosted Supabase's DEFAULT PRIVILEGES
-- on `public` (new tables, sequences and functions are granted to anon,
-- authenticated and service_role), so a migration that forgets its
-- explicit revoke exposes the object here exactly as it would on hosted
-- Supabase, and the meta DB tests (tests/db/meta.test.ts, "API surface")
-- fail.
--
-- Run as a superuser against the target database. Idempotent. Roles are
-- cluster-wide; schemas and grants are per database.
--
-- Local-only passwords: every login role uses the password `postgres`, as
-- the Supabase CLI's local stack does. Nothing here is a secret.

-- ---------------------------------------------------------------------------
-- Roles (cluster-wide)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin login noinherit createrole;
  end if;
  -- Supabase Auth's migrations grant to `postgres` by name. A cluster whose
  -- bootstrap superuser has another name (initdb -U, some CI images) has no
  -- such role; a NOLOGIN placeholder is enough for those grants.
  if not exists (select from pg_roles where rolname = 'postgres') then
    create role postgres nologin;
  end if;
end
$$;

-- Re-assert attributes in case a role pre-existed with different ones.
alter role anon nologin noinherit;
alter role authenticated nologin noinherit;
alter role service_role nologin noinherit bypassrls;
alter role authenticator login noinherit password 'postgres';
alter role supabase_auth_admin login noinherit createrole password 'postgres';
alter role supabase_storage_admin login noinherit createrole password 'postgres';

-- PostgREST switches from authenticator to the role in the JWT.
grant anon, authenticated, service_role to authenticator;
-- Supabase grants the API roles to postgres (so it can `set role` in tests
-- and in the SQL editor) and to the storage admin (Storage runs each request
-- under the caller's role so storage.objects RLS applies). The superuser
-- running this file may not be called postgres (a CI service container or a
-- laptop cluster can name it anything), so grant to whoever runs it too.
grant anon, authenticated, service_role to current_user;
grant anon, authenticated, service_role to postgres;
grant anon, authenticated, service_role to supabase_storage_admin;

alter role supabase_auth_admin set search_path = auth;
alter role supabase_storage_admin set search_path = storage;

-- ---------------------------------------------------------------------------
-- Schemas and grants (this database)
-- ---------------------------------------------------------------------------
do $$
begin
  execute format(
    'grant create, connect, temporary on database %I to supabase_auth_admin, supabase_storage_admin',
    current_database()
  );
  execute format(
    'grant connect, temporary on database %I to authenticator, anon, authenticated, service_role',
    current_database()
  );
end
$$;

create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;
create schema if not exists extensions;

-- What Supabase grants on its platform schemas. (Our migrations grant on
-- `public` and `extensions` again explicitly; repeating a grant is a no-op.)
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
grant all on schema auth to supabase_auth_admin;
grant all on schema storage to supabase_storage_admin;

-- ---------------------------------------------------------------------------
-- Hosted Supabase's default privileges on `public`, for the role that runs
-- the migrations. Hosted (and `supabase start`) run
--   alter default privileges [for role postgres] in schema public
--     grant all on tables|functions|sequences to anon, authenticated, service_role;
-- Migrations here run as whichever superuser runs the scripts (postgres
-- locally, another name on some CI images), so grant for that role, and for
-- `postgres` too when it is a different role.
-- ---------------------------------------------------------------------------
do $$
declare
  migration_role text;
begin
  foreach migration_role in array array[current_user::text, 'postgres'] loop
    execute format(
      'alter default privileges for role %I in schema public grant all on tables to anon, authenticated, service_role',
      migration_role
    );
    execute format(
      'alter default privileges for role %I in schema public grant all on sequences to anon, authenticated, service_role',
      migration_role
    );
    execute format(
      'alter default privileges for role %I in schema public grant all on functions to anon, authenticated, service_role',
      migration_role
    );
  end loop;
end
$$;
