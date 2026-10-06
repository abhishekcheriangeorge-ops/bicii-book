-- Shopify refunds follow the staff roles (PLAN D86, D94; ADR-020, ADR-021;
-- DATA-MODEL.md §13, §15, §16). The reconciling migration of the merge of
-- feat/p8-labels (with main) into feat/p10-shopify: it sorts after every
-- 20261005... and 20261006... migration, so it is the final definition of
-- each object it replaces.
--
-- Rules encoded here:
--   * D94 decides that recording a refund (money going out) belongs to an
--     active admin or manager (private.can_record_refunds(), a role check;
--     no exception grants it). Phase 10's D86 had made every inbound
--     Shopify job admin-only. An online refund is recorded by the service
--     role when its webhook arrives (process_shopify_refund, unchanged);
--     what a person does is retry or dismiss a refund's job that needs
--     attention. Those two actions now follow D94: an admin or a manager.
--   * Orders stay admin-only (D86: their payloads name customers; linking
--     variants and customers stays admin-only), as do product-sync
--     dismissals, the audit trail and the Shopify settings
--     (set_shopify_settings, require_admin, unchanged). manage_inventory
--     still retries product-sync jobs (unchanged).
--   * A manager reads exactly the refunds/create events and their jobs
--     (RLS), and sees a refund job that needs attention as an
--     integration_failed exception on Today; admins see everything as before.
--   * Copied unchanged from 20261004004000_shopify_order_processing.sql
--     except the guards: retry_integration_job, dismiss_integration_job and
--     private.integration_exceptions (same signatures).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when the event is a Shopify refund (refunds/create). Definer: the
-- queue's RLS policy reads the event's topic without the events policy.
create function private.is_refund_event(event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.integration_events e
    where e.id = is_refund_event.event_id and e.topic = 'refunds/create'
  );
$$;

comment on function private.is_refund_event(uuid) is
  'D94: the integration event is a Shopify refund (topic refunds/create). Used by the refund-job RLS policies and guards.';

-- The RLS face of private.can_record_refunds() (whose EXECUTE stays
-- revoked from every API role): the caller is an active admin or manager.
create function private.can_handle_refund_jobs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_record_refunds();
$$;

comment on function private.can_handle_refund_jobs() is
  'D94: the caller may see, retry and dismiss Shopify refund jobs (an active admin or manager; private.can_record_refunds()). For RLS policies.';

-- ---------------------------------------------------------------------------
-- RLS: managers read refund events and their jobs (D94)
-- ---------------------------------------------------------------------------
create policy integration_events_select_refunds on public.integration_events
  for select to authenticated
  using (topic = 'refunds/create' and (select private.can_handle_refund_jobs()));

create policy integration_retry_queue_select_refunds on public.integration_retry_queue
  for select to authenticated
  using (
    kind = 'shopify_event'
    and (select private.can_handle_refund_jobs())
    and private.is_refund_event(integration_event_id)
  );

-- ---------------------------------------------------------------------------
-- retry_integration_job (admin; manage_inventory for a product sync, D86;
-- admin or manager for a refund, D94)
-- ---------------------------------------------------------------------------
create or replace function public.retry_integration_job(job_id uuid)
returns public.integration_retry_queue
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_staff();
  job public.integration_retry_queue;
begin
  if not private.is_admin() and not private.has_permission('manage_inventory')
     and not private.can_record_refunds() then
    raise exception 'an admin retries integration jobs' using errcode = '42501';
  end if;
  if retry_integration_job.job_id is null then
    raise exception 'job_id is required' using errcode = '22004';
  end if;
  select q.* into job from public.integration_retry_queue q where q.id = retry_integration_job.job_id for update;
  if not found then
    raise exception 'integration job % not found', retry_integration_job.job_id using errcode = 'P0002';
  end if;
  -- D86: only admins handle inbound orders (their payloads name
  -- customers); a refund is money going out, so an admin or a manager
  -- retries a refund's job (D94).
  if job.kind <> 'product_sync' and not private.is_admin()
     and not (private.can_record_refunds() and private.is_refund_event(job.integration_event_id)) then
    raise exception 'an admin retries Shopify order jobs; an admin or a manager retries refund jobs'
      using errcode = '42501';
  end if;
  if job.status in ('done', 'dismissed') then
    raise exception using
      errcode = 'P0001',
      message = 'integration_job_closed',
      detail = 'That item was already resolved.';
  end if;
  if job.status = 'running' then
    return job;
  end if;
  update public.integration_retry_queue q
  set status = 'queued', next_attempt_at = pg_catalog.now(), locked_at = null,
      max_attempts = greatest(q.max_attempts, q.attempts + 3),
      last_retried_by = actor, last_retried_at = pg_catalog.now()
  where q.id = job.id
  returning q.* into job;
  insert into public.integration_audit_events (
    event_type, product_id, job_id, integration_event_id, actor_staff_id, payload, correlation_id
  )
  values (
    'job_retried', job.product_id, job.id, job.integration_event_id, actor,
    pg_catalog.jsonb_build_object('attempts', job.attempts, 'max_attempts', job.max_attempts),
    private.current_correlation_id()
  );
  return job;
end;
$$;

comment on function public.retry_integration_job(uuid) is
  'Admins; staff with manage_inventory for product-sync jobs only (D86); admins and managers for refund jobs (D94): re-queue a queued or needs_attention job now, allowing at least three more attempts (D87); a running job is returned unchanged; done or dismissed -> integration_job_closed. Audited (job_retried).';

-- ---------------------------------------------------------------------------
-- dismiss_integration_job (admin; admin or manager for a refund, D94;
-- reason required)
-- ---------------------------------------------------------------------------
create or replace function public.dismiss_integration_job(job_id uuid, reason text)
returns public.integration_retry_queue
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  actor uuid := private.require_staff();
  cleaned text := private.require_reason(dismiss_integration_job.reason);
  job public.integration_retry_queue;
  ev public.integration_events;
  closed uuid[] := '{}';
  closed_orders uuid[] := '{}';
begin
  -- D86 and D94: admins dismiss any job; a manager only a refund's job
  -- (checked below, once the job is read). Everyone else is refused first.
  if not private.is_admin() and not private.can_record_refunds() then
    raise exception 'an admin dismisses integration jobs' using errcode = '42501';
  end if;
  if dismiss_integration_job.job_id is null then
    raise exception 'job_id is required' using errcode = '22004';
  end if;
  -- Lock order as the processors': the event rows first, then the jobs. An
  -- order's deliveries (every orders/paid event of its gid) are locked
  -- together in id order, so two dismissals of one order never deadlock.
  select q.* into job from public.integration_retry_queue q where q.id = dismiss_integration_job.job_id;
  if not found then
    raise exception 'integration job % not found', dismiss_integration_job.job_id using errcode = 'P0002';
  end if;
  if not private.is_admin()
     and not (job.kind = 'shopify_event' and private.is_refund_event(job.integration_event_id)) then
    raise exception 'an admin dismisses Shopify order and product-sync jobs; an admin or a manager dismisses refund jobs'
      using errcode = '42501';
  end if;
  if job.integration_event_id is not null then
    select e.* into ev from public.integration_events e where e.id = job.integration_event_id;
    if ev.topic = 'orders/paid' and ev.shopify_order_gid is not null then
      perform 1
      from public.integration_events o
      where o.topic = 'orders/paid' and o.shopify_order_gid = ev.shopify_order_gid
      order by o.id
      for update;
    else
      perform 1 from public.integration_events e where e.id = ev.id for update;
    end if;
  end if;
  select q.* into job from public.integration_retry_queue q where q.id = job.id for update;
  if job.status = 'running' then
    raise exception using
      errcode = 'P0001',
      message = 'integration_job_running',
      detail = 'That item is being retried right now. Try again in a moment.';
  end if;
  if job.status in ('done', 'dismissed') then
    raise exception using
      errcode = 'P0001',
      message = 'integration_job_closed',
      detail = 'That item was already resolved.';
  end if;

  update public.integration_retry_queue q
  set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = actor, resolution_reason = cleaned,
      locked_at = null
  where q.id = job.id
  returning q.* into job;

  if job.kind = 'shopify_event' then
    -- The event keeps its last error as the record of why.
    update public.integration_events e
    set status = 'skipped', outcome = 'dismissed', processed_at = pg_catalog.now()
    where e.id = job.integration_event_id
    returning e.* into ev;
    if ev.topic = 'orders/paid' and ev.shopify_order_gid is not null
       and not exists (select 1 from public.sales s where s.shopify_order_id = ev.shopify_order_gid) then
      -- A dismissal is final for the order (D87): its other open
      -- deliveries (another webhook id) close with it, so none can record
      -- it later and none stays on Today. Their events are locked above.
      with sibling_jobs as (
        select q.id
        from public.integration_retry_queue q
        join public.integration_events o on o.id = q.integration_event_id
        where q.kind = 'shopify_event' and q.status in ('queued', 'needs_attention')
          and o.topic = 'orders/paid' and o.shopify_order_gid = ev.shopify_order_gid and o.id <> ev.id
          and o.status in ('pending', 'failed')
        order by q.id
        for update of q
      ),
      closed_sibling_jobs as (
        update public.integration_retry_queue q
        set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = actor, locked_at = null,
            resolution_reason = pg_catalog.left('Another delivery of this order was dismissed: ' || cleaned, 500)
        from sibling_jobs w
        where q.id = w.id
        returning q.id, q.integration_event_id
      ),
      closed_sibling_events as (
        update public.integration_events e
        set status = 'skipped', outcome = 'dismissed', processed_at = pg_catalog.now()
        from closed_sibling_jobs c
        where e.id = c.integration_event_id
        returning e.id
      )
      select coalesce(pg_catalog.array_agg(c.id order by c.id), '{}') into closed_orders
      from closed_sibling_jobs c;
      -- The waiting refunds' events, then their jobs (the processors' order).
      perform 1
      from public.integration_events r
      where r.topic = 'refunds/create' and r.shopify_order_gid = ev.shopify_order_gid
      order by r.id
      for update;
      with waiting as (
        select q.id
        from public.integration_retry_queue q
        join public.integration_events r on r.id = q.integration_event_id
        where q.kind = 'shopify_event' and q.status in ('queued', 'needs_attention')
          and r.topic = 'refunds/create' and r.shopify_order_gid = ev.shopify_order_gid
        order by q.id
        for update of q
      ),
      closed_jobs as (
        update public.integration_retry_queue q
        set status = 'dismissed', resolved_at = pg_catalog.now(), resolved_by = actor, locked_at = null,
            resolution_reason = pg_catalog.left('The order was dismissed: ' || cleaned, 500)
        from waiting w
        where q.id = w.id
        returning q.id, q.integration_event_id
      ),
      closed_events as (
        update public.integration_events e
        set status = 'skipped', outcome = 'order_not_recorded', processed_at = pg_catalog.now()
        from closed_jobs c
        where e.id = c.integration_event_id
        returning e.id
      )
      select coalesce(pg_catalog.array_agg(c.id order by c.id), '{}') into closed
      from closed_jobs c;
    end if;
  end if;

  insert into public.integration_audit_events (
    event_type, product_id, job_id, integration_event_id, actor_staff_id, reason, payload, correlation_id
  )
  values (
    'job_dismissed', job.product_id, job.id, job.integration_event_id, actor, cleaned,
    pg_catalog.jsonb_build_object(
      'closed_refund_job_ids', pg_catalog.to_jsonb(closed),
      'closed_order_job_ids', pg_catalog.to_jsonb(closed_orders)
    ),
    private.current_correlation_id()
  );
  return job;
end;
$$;

comment on function public.dismiss_integration_job(uuid, text) is
  'Admins (D86); admins and managers for refund jobs (D94); reason required: close a queued or needs_attention job (its event becomes skipped / dismissed and keeps its last error); dismissing an order is final for that order (D87): unless a sale already exists for it, its other open deliveries close too (skipped / dismissed, ''Another delivery of this order was dismissed: '' || reason) and its waiting refunds close (order_not_recorded); a later delivery of the order or of a refund of it is skipped (earlier_delivery_skipped / order_not_recorded). running -> integration_job_running; done or dismissed -> integration_job_closed. Audited (job_dismissed).';

-- ---------------------------------------------------------------------------
-- Operational exceptions: a refund job that needs attention is a manager's
-- too (D94); everything else stays admin-only (D86)
-- ---------------------------------------------------------------------------
create or replace function private.integration_exceptions()
returns table (
  kind text,
  severity text,
  entity_type text,
  entity_id uuid,
  entity_label text,
  subject_label text,
  days integer,
  quantity integer,
  since timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'integration_failed'::text,
         'danger'::text,
         'integration_job'::text,
         q.id,
         (case when q.kind = 'shopify_event' then coalesce(e.subject, e.topic) else p.short_id end)::text,
         pg_catalog.left(q.last_error, 300)::text,
         (private.shop_today() - private.shop_day(q.created_at))::integer,
         null::integer,
         q.created_at
  from public.integration_retry_queue q
  left join public.integration_events e on e.id = q.integration_event_id
  left join public.products p on p.id = q.product_id
  where q.status = 'needs_attention'
    and (private.is_admin()
         or (q.kind = 'shopify_event' and e.topic = 'refunds/create' and private.can_record_refunds()));
$$;

comment on function private.integration_exceptions() is
  'D86, D94: one integration_failed row (danger) per needs_attention job, for admins (every job) and managers (refund jobs only; zero rows otherwise): entity_type integration_job, the job id, the event subject or product short ID, the human message (<= 300), days since the job was created. Read only through reporting.operational_exceptions inside the definer RPCs; no API role may execute it. Phase 9 widens its columns with the view''s.';

-- ---------------------------------------------------------------------------
-- Privileges (restated for every function created or replaced here)
-- ---------------------------------------------------------------------------
revoke all on function
  private.is_refund_event(uuid),
  private.can_handle_refund_jobs(),
  private.integration_exceptions()
from public, anon, authenticated, service_role;

-- The RLS policies above call both as the caller.
grant execute on function
  private.is_refund_event(uuid),
  private.can_handle_refund_jobs()
to authenticated;

revoke all on function
  public.retry_integration_job(uuid),
  public.dismiss_integration_job(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.retry_integration_job(uuid),
  public.dismiss_integration_job(uuid, text)
to authenticated;
