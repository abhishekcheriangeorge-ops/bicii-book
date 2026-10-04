-- What a customer sees of their own workshop jobs (SPEC §4 "Customer", §7,
-- §23 "Customers cannot read internal notes, costs, yield ... or Cult
-- Commons data"; DATA-MODEL.md §15 "Customer access pattern", §16; PLAN D8,
-- D17, D19).
--
-- Built now, shown in Phase 11 (the public site's account pages). The
-- pattern is the Phase 1 one (20261004001000_customer_access.sql): the
-- workshop base tables are staff-only, and a signed-in customer reads their
-- jobs through these security-definer RPCs, which
--   * resolve the caller with private.current_customer_id() and never take a
--     customer id;
--   * return an explicit list of customer-safe columns;
--   * return nothing, not an error, for another customer's job or a caller
--     without a customers row;
--   * are executable by `authenticated` only.
--
-- D17, which jobs and what of them:
--   * the jobs where the caller is work_orders.customer_id, whoever owns the
--     bike now (a new owner does not see the previous owner's jobs) and
--     whether or not the bike is archived since;
--   * cancelled jobs are hidden;
--   * status is shown as a coarse customer status (customer_job_status):
--     the internal steps before work starts read `received`, a pause reads
--     `in_progress`;
--   * lines show description, quantity, unit price and total only (live
--     lines; voided ones are hidden);
--   * the timeline shows check-in, changes of the customer status and the
--     job's customer-visible photos (D8);
--   * requested work, intake/internal/completion notes, approval,
--     assignments, actors, event payloads and every cost, yield, rate or
--     Cult Commons value are never returned.

create type public.customer_job_status as enum (
  'received',
  'awaiting_customer',
  'awaiting_parts',
  'in_progress',
  'completed',
  'ready_for_collection',
  'collected'
);

comment on type public.customer_job_status is
  'A job''s status as its customer sees it (D17): coarser than work_order_status; cancelled jobs are not shown at all.';

-- The customer status of a job status; null for cancelled (never shown).
create function private.customer_job_status(s public.work_order_status)
returns public.customer_job_status
language sql
immutable
set search_path = ''
as $$
  select case s
    when 'received' then 'received'
    when 'diagnosing' then 'received'
    when 'ready_to_start' then 'received'
    when 'awaiting_customer' then 'awaiting_customer'
    when 'awaiting_parts' then 'awaiting_parts'
    when 'in_progress' then 'in_progress'
    when 'paused' then 'in_progress'
    when 'completed' then 'completed'
    when 'ready_for_collection' then 'ready_for_collection'
    when 'collected' then 'collected'
  end::public.customer_job_status;
$$;

-- The caller's jobs, newest first, with the live lines' sale total.
create function public.my_work_orders()
returns table (
  id uuid,
  job_number text,
  bike_id uuid,
  bike_short_id text,
  bike_title text,
  status public.customer_job_status,
  checked_in_at timestamptz,
  completed_at timestamptz,
  ready_for_collection_at timestamptz,
  collected_at timestamptz,
  currency text,
  sale_total public.money_amount
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.job_number, w.bike_id, b.short_id,
         b.brand || ' ' || b.model || coalesce(' ' || b.variant, ''),
         private.customer_job_status(w.status),
         w.checked_in_at, w.completed_at, w.ready_for_collection_at, w.collected_at,
         w.currency::text,
         t.sale_total
  from public.work_orders w
  join public.bikes b on b.id = w.bike_id
  -- work_order_totals' sale side: live (non-voided) lines only.
  cross join lateral (
    select coalesce(sum(li.sale_total) filter (where li.voided_at is null), 0)::public.money_amount
             as sale_total
    from public.work_order_line_items li
    where li.work_order_id = w.id
  ) t
  where w.customer_id = private.current_customer_id()
    and w.status <> 'cancelled'
  order by w.checked_in_at desc, w.id desc;
$$;

comment on function public.my_work_orders() is
  'Signed-in customer: their own jobs (not cancelled), newest first, with the customer status and sale total only (D17).';

-- The live lines of one of the caller's jobs: sale side only.
create function public.my_work_order_lines(work_order_id uuid)
returns table (
  id uuid,
  description text,
  quantity public.line_quantity,
  unit_sale_price public.money_amount,
  sale_total public.money_amount,
  currency text
)
language sql
stable
security definer
set search_path = ''
as $$
  select li.id, li.description_snapshot, li.quantity, li.unit_sale_price_snapshot,
         li.sale_total, li.currency::text
  from public.work_order_line_items li
  join public.work_orders w on w.id = li.work_order_id
  where li.work_order_id = my_work_order_lines.work_order_id
    and li.voided_at is null
    and w.customer_id = private.current_customer_id()
    and w.status <> 'cancelled'
  order by li.created_at, li.id;
$$;

comment on function public.my_work_order_lines(uuid) is
  'Signed-in customer: the live lines of one of their jobs (description, quantity, unit price, total; never costs) (D17).';

-- One of the caller's jobs as a customer timeline, oldest first:
--   checked_in  the check-in (status received);
--   status      a change of the CUSTOMER status (status_changed, completed,
--               ready_for_collection, collected, reopened events whose mapped
--               status differs from the previous entry's);
--   photo       a photo still on the job and visible to the customer.
-- No actors, notes, payloads, assignments, lines or costs.
create function public.my_work_order_timeline(work_order_id uuid)
returns table (
  id bigint,
  kind text,
  status public.customer_job_status,
  attachment_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with job as (
    select w.id
    from public.work_orders w
    where w.id = my_work_order_timeline.work_order_id
      and w.customer_id = private.current_customer_id()
      and w.status <> 'cancelled'
  ),
  statuses as (
    select e.id, e.created_at,
           case when e.event_type = 'checked_in' then 'checked_in' else 'status' end as kind,
           case
             when e.event_type = 'checked_in' then 'received'::public.customer_job_status
             else private.customer_job_status((e.payload ->> 'to')::public.work_order_status)
           end as status
    from public.work_order_events e
    join job on job.id = e.work_order_id
    where e.event_type in (
      'checked_in', 'status_changed', 'completed', 'ready_for_collection', 'collected', 'reopened'
    )
  ),
  changes as (
    select s.*, lag(s.status) over (order by s.created_at, s.id) as previous
    from statuses s
  )
  select c.id, c.kind, c.status, null::uuid, c.created_at
  from changes c
  where c.kind = 'checked_in' or c.status is distinct from c.previous
  union all
  select e.id, 'photo', null, a.id, e.created_at
  from public.work_order_events e
  join job on job.id = e.work_order_id
  join public.attachments a
    on a.entity_type = 'work_order'
   and a.entity_id = job.id
   and a.id::text = e.payload ->> 'attachment_id'
  where e.event_type = 'photo_added'
    and a.visibility in ('customer', 'public')
  order by 5, 1;
$$;

comment on function public.my_work_order_timeline(uuid) is
  'Signed-in customer: one of their jobs as check-in, customer-status changes and customer-visible photos (D8, D17).';

-- Customer-visible photos of one of the caller's jobs (the job's customer,
-- D17; never public, D19). Same columns as my_bike_attachments.
create function public.my_work_order_attachments(work_order_id uuid)
returns table (
  id uuid,
  storage_bucket text,
  storage_path text,
  media_type text,
  width integer,
  height integer,
  caption text,
  visibility public.attachment_visibility,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.storage_bucket, a.storage_path, a.media_type,
         a.width, a.height, a.caption, a.visibility, a.created_at
  from public.attachments a
  join public.work_orders w on w.id = a.entity_id
  where a.entity_type = 'work_order'
    and a.entity_id = my_work_order_attachments.work_order_id
    and a.visibility in ('customer', 'public')
    and w.customer_id = private.current_customer_id()
    and w.status <> 'cancelled'
  order by a.created_at, a.id;
$$;

comment on function public.my_work_order_attachments(uuid) is
  'Signed-in customer: customer-visible photos of one of their jobs (D17, D19).';

revoke all on function private.customer_job_status(public.work_order_status)
  from public, anon, authenticated, service_role;

revoke all on function
  public.my_work_orders(),
  public.my_work_order_lines(uuid),
  public.my_work_order_timeline(uuid),
  public.my_work_order_attachments(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.my_work_orders(),
  public.my_work_order_lines(uuid),
  public.my_work_order_timeline(uuid),
  public.my_work_order_attachments(uuid)
to authenticated;
