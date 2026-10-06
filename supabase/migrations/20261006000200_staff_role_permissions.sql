-- What each staff role implies, exceptions on top of it, and refunds for
-- managers (PLAN D91 ROLE-PERMISSIONS, D92 ROLE-EXCEPTIONS, D94
-- REFUND-ROLES; ADR-021; DATA-MODEL.md §1, §15, §16).
--
-- Rules encoded here:
--   * One rule for what a role implies, private.role_implies(role,
--     permission): admin implies every permission; manager every permission
--     except manage_staff; mechanic none. private.has_permission and
--     public.my_staff_profile both use it, so every RLS policy, view and RPC
--     that calls has_permission / require_permission / can_view_* follows.
--     The app mirrors it in roleImplies() (src/lib/auth/permissions.ts); a
--     database test proves the two agree for every role and permission.
--   * Effective permissions = what the role implies plus the person's
--     staff_permissions rows ("Extra access" exceptions); none while
--     inactive.
--   * A staff_permissions row the person's role already implies cannot
--     exist: a BEFORE INSERT trigger refuses it for every writer (RPC, seed,
--     SQL editor) with P0001 permission_implied_by_role. When a role change
--     makes a row implied, an AFTER UPDATE OF role trigger deletes it in the
--     same transaction; the existing history trigger appends one
--     permission_revoked event per row with the role change's actor and
--     reason. A later demotion does not bring the rows back.
--   * Retail refunds (money going out, D49) are recorded by an active admin
--     or manager: private.can_record_refunds() is a role check, not a
--     permission, so view_financial_reports is still never enough and no
--     exception grants it. Everything else about refunds is unchanged.
--   * Admin-only things stay admin-only through private.is_admin() /
--     private.require_admin() (shop settings, hours, closures, appointment
--     types, Cult Commons rates, roles, admin and manager accounts).

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
create function private.role_implies(role public.staff_role, permission public.permission_key)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case role_implies.role
    when 'admin' then true
    when 'manager' then coalesce(role_implies.permission <> 'manage_staff', false)
    else false
  end;
$$;

comment on function private.role_implies(public.staff_role, public.permission_key) is
  'D91: whether a role implies a permission. admin: all; manager: all except manage_staff; mechanic and null: none. Mirrored by roleImplies() in src/lib/auth/permissions.ts.';

-- Same signature and grants as 20261004000200_staff.sql.
create or replace function private.has_permission(permission public.permission_key)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (
        private.role_implies(s.role, has_permission.permission)
        or exists (
          select 1 from public.staff_permissions sp
          where sp.staff_id = s.id and sp.permission = has_permission.permission
        )
      )
  );
$$;

comment on function private.has_permission(public.permission_key) is
  'D91: the caller is active staff whose role implies the permission (private.role_implies) or who holds it as an exception (staff_permissions).';

-- The caller's staff row plus effective permissions (enum order): what the
-- role implies plus their exceptions; none when inactive. Zero rows when
-- the caller has no staff row (e.g. a customer). Same columns as before.
create or replace function public.my_staff_profile()
returns table (
  id uuid,
  auth_user_id uuid,
  display_name text,
  email text,
  role public.staff_role,
  active boolean,
  permissions public.permission_key[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.auth_user_id,
    s.display_name,
    s.email::text,
    s.role,
    s.active,
    case
      when not s.active then '{}'::public.permission_key[]
      else coalesce(
        (select pg_catalog.array_agg(p.permission order by p.permission)
         from pg_catalog.unnest(pg_catalog.enum_range(null::public.permission_key)) as p (permission)
         where private.role_implies(s.role, p.permission)
            or exists (
              select 1 from public.staff_permissions sp
              where sp.staff_id = s.id and sp.permission = p.permission
            )),
        '{}'::public.permission_key[]
      )
    end
  from public.staff s
  where s.auth_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Refunds (D94 amends D49)
-- ---------------------------------------------------------------------------
create function private.can_record_refunds()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and s.role in ('admin', 'manager')
  );
$$;

comment on function private.can_record_refunds() is
  'D94: the caller is an active admin or manager. A role check: no permission or exception grants it.';

-- Copied unchanged from 20261004003500_sales.sql except the guard (D94).
create or replace function public.record_sale_refund(
  refund_id uuid,
  sale_id uuid,
  amount public.money_amount,
  reason text
)
returns public.sale_refunds
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_staff();
  cleaned text := nullif(pg_catalog.btrim(coalesce(record_sale_refund.reason, '')), '');
  existing public.sale_refunds;
  sale public.sales;
  sale_total numeric;
  refunded numeric;
  inserted public.sale_refunds;
  err_state text;
  err_constraint text;
  err_table text;
  err_schema text;
  err_column text;
  err_message text;
begin
  -- D94 (amends D49): view_financial_reports is a read permission; money
  -- going out is an admin's or a manager's decision, by role.
  if not private.can_record_refunds() then
    raise exception 'an admin or a manager records refunds' using errcode = '42501';
  end if;
  if record_sale_refund.refund_id is null or record_sale_refund.sale_id is null
     or record_sale_refund.amount is null then
    raise exception 'refund_id, sale_id and amount are required' using errcode = '22004';
  end if;

  select r.* into existing from public.sale_refunds r where r.id = record_sale_refund.refund_id;
  if found then
    if existing.sale_id = record_sale_refund.sale_id and existing.amount = record_sale_refund.amount
       and existing.reason is not distinct from cleaned then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'sale_refund_conflict',
      detail = 'That refund id is already used for another refund.';
  end if;
  if cleaned is null then
    raise exception using
      errcode = 'P0001',
      message = 'reason_required',
      detail = 'Say why the sale is being refunded.';
  end if;
  if pg_catalog.char_length(cleaned) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'reason_too_long',
      detail = 'Keep the reason under 500 characters.';
  end if;

  select s.* into sale from public.sales s where s.id = record_sale_refund.sale_id for update;
  if not found then
    raise exception 'sale % not found', record_sale_refund.sale_id using errcode = 'P0002';
  end if;
  -- A concurrent replay waited on the sale: check again under the lock.
  select r.* into existing from public.sale_refunds r where r.id = record_sale_refund.refund_id;
  if found then
    if existing.sale_id = record_sale_refund.sale_id and existing.amount = record_sale_refund.amount
       and existing.reason is not distinct from cleaned then
      return existing;
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'sale_refund_conflict',
      detail = 'That refund id is already used for another refund.';
  end if;
  if sale.status = 'voided' then
    raise exception using
      errcode = 'P0001',
      message = 'sale_voided',
      detail = 'That sale was voided.';
  end if;

  select coalesce(sum(sl.sale_total), 0) into sale_total from public.sale_lines sl where sl.sale_id = sale.id;
  select coalesce(sum(r.amount), 0) into refunded from public.sale_refunds r where r.sale_id = sale.id;
  if record_sale_refund.amount > sale_total - refunded then
    raise exception using
      errcode = 'P0001',
      message = 'refund_exceeds_sale',
      detail = pg_catalog.format(
        'At most %s is left to refund on %s.', pg_catalog.to_char(sale_total - refunded, 'FM999,999,990.00'),
        sale.sale_number
      );
  end if;

  begin
    insert into public.sale_refunds as r (id, sale_id, amount, currency, reason, restocked, recorded_by)
    values (record_sale_refund.refund_id, sale.id, record_sale_refund.amount, sale.currency, cleaned, false, actor)
    returning r.* into inserted;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        err_state = returned_sqlstate, err_constraint = constraint_name, err_table = table_name,
        err_schema = schema_name, err_column = column_name, err_message = message_text;
      perform private.raise_without_row(err_state, err_constraint, err_table, err_schema, err_column, err_message);
  end;

  update public.sales s
  set status = case
        when refunded + record_sale_refund.amount >= sale_total then 'refunded'::public.sale_status
        else 'partially_refunded'::public.sale_status
      end
  where s.id = sale.id;
  return inserted;
end;
$$;

comment on function public.record_sale_refund(uuid, uuid, public.money_amount, text) is
  'Admins and managers (D94, amends D49): refund part or all of a sale with a reason, capped at the sale total minus earlier refunds; financial only (D7: no movement, no unit change); the sale becomes partially_refunded or refunded; replay-safe by refund id.';

-- ---------------------------------------------------------------------------
-- Exceptions (D92)
-- ---------------------------------------------------------------------------

-- Every writer: a row the person's role already implies is refused. FOR
-- SHARE waits for a concurrent role change on the person, so the check
-- reads the role that will be committed.
create function private.staff_permissions_refuse_implied()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.staff_role;
begin
  select s.role into target_role from public.staff s where s.id = new.staff_id for share;
  if private.role_implies(target_role, new.permission) then
    raise exception using
      errcode = 'P0001',
      message = 'permission_implied_by_role',
      detail = 'Their role already includes that permission.';
  end if;
  return new;
end;
$$;

create trigger staff_permissions_refuse_implied
  before insert on public.staff_permissions
  for each row execute function private.staff_permissions_refuse_implied();

-- Every writer: after a role change, the person's exceptions that the new
-- role implies are deleted in the same transaction. Named so it fires after
-- staff_record_history (AFTER triggers fire in name order): the
-- role_changed event comes first, then one permission_revoked event per
-- deleted row (staff_permissions_record_history) with the same actor and
-- reason (app.staff_event_reason, which update_staff sets).
create function private.staff_role_drop_implied_exceptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    delete from public.staff_permissions sp
    where sp.staff_id = new.id
      and private.role_implies(new.role, sp.permission);
  end if;
  return null;
end;
$$;

create trigger staff_role_drop_implied_exceptions
  after update of role on public.staff
  for each row execute function private.staff_role_drop_implied_exceptions();

-- Existing data: the two triggers only guard new writes. Before the roles,
-- an admin could grant any permission to another admin and a promotion
-- kept the person's rows, so a database migrated step by step (db:migrate,
-- not db:reset) can already hold rows the role implies. Left in place, a
-- later demotion would make them live again, which D92 rules out. This
-- deletes them once, here; staff_permissions_record_history appends one
-- permission_revoked event per row (no actor: no one is signed in during a
-- migration) with a fixed reason. Kept as a function so a database test can
-- build the pre-roles state and prove the clean-up.
create function private.drop_implied_exceptions()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  dropped integer;
begin
  perform pg_catalog.set_config(
    'app.staff_event_reason', 'Staff roles (D92): their role already includes this permission.', true
  );
  delete from public.staff_permissions sp
  using public.staff s
  where s.id = sp.staff_id
    and private.role_implies(s.role, sp.permission);
  get diagnostics dropped = row_count;
  perform pg_catalog.set_config('app.staff_event_reason', '', true);
  return dropped;
end;
$$;

select private.drop_implied_exceptions();

comment on table public.staff is
  'Workshop staff (D90): role admin, manager or mechanic (default). Active staff are authorized by what their role implies (private.role_implies) plus their exceptions (staff_permissions); inactive staff by nothing.';

comment on table public.staff_permissions is
  'Exceptions on top of the role (D92, "Extra access"): a permission granted to one person that their role does not imply. A row the role implies is refused (permission_implied_by_role) and is deleted when a role change makes it implied. Ignored while the person is inactive.';

-- ---------------------------------------------------------------------------
-- Privileges (restated for every function created or replaced here)
-- ---------------------------------------------------------------------------
revoke all on function
  private.role_implies(public.staff_role, public.permission_key),
  private.has_permission(public.permission_key),
  private.can_record_refunds(),
  private.staff_permissions_refuse_implied(),
  private.staff_role_drop_implied_exceptions(),
  private.drop_implied_exceptions()
from public, anon, authenticated, service_role;

-- RLS policies call has_permission as the caller (20261004000200_staff.sql).
grant execute on function private.has_permission(public.permission_key) to authenticated;

revoke all on function
  public.my_staff_profile(),
  public.record_sale_refund(uuid, uuid, public.money_amount, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.my_staff_profile(),
  public.record_sale_refund(uuid, uuid, public.money_amount, text)
to authenticated;
