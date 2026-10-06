-- Period-report volume bench (Phase 9; DATA-MODEL §14 "Report timings";
-- docs/ENGINEERING.md "Report volume bench"). Measured, not a test.
--
-- NEVER run this against bicii_dev or bicii_dev_wt: it inserts a year of
-- synthetic rows. Run it on a throwaway clone and drop the clone:
--
--   createdb bicii_bench_wt
--   pg_dump --no-owner bicii_dev_wt | psql -q bicii_bench_wt
--   psql -v ON_ERROR_STOP=1 -f scripts/bench/report-volume.sql bicii_bench_wt
--   dropdb bicii_bench_wt
--
-- (with PGHOST, PGUSER and PGPASSWORD set for the local server).
--
-- Volumes (one year ending today): about 15,000 jobs, 50,000 work-order
-- lines, 10,000 sale lines, 100,000 stock movements and 2,000 receipt
-- lines. Rows are owner inserts with session_replication_role = replica,
-- so the append-only and short-ID triggers do not run (the rows carry
-- their own numbers) while every CHECK constraint still holds.
--
-- Targets (Phase 9 step 1): a month under 300 ms, a year under 1.5 s, a
-- line-items page under 100 ms, report_stock_value under 300 ms. Step 3:
-- reconciliation and operational_exceptions under 500 ms,
-- report_exception_counts and today_dashboard under 150 ms.
--
-- Structure: section 1 generates data, section 2 times the period
-- reports, section 3 (Phase 9 step 3) adds about 3,000 unique units and
-- times reconciliation and the exceptions.

\set ON_ERROR_STOP 1
\pset pager off

-- ===========================================================================
-- 1. Synthetic data
-- ===========================================================================
begin;
set local session_replication_role = replica;
select setseed(0.42);

create temporary table bench_customers on commit drop as
select gen_random_uuid() as customer_id, gen_random_uuid() as bike_id, g as n
from generate_series(1, 3000) g;

insert into public.customers (id, display_name)
select customer_id, 'Bench customer ' || n from bench_customers;

insert into public.bikes (id, short_id, customer_id, brand, model)
select bike_id, 'B-' || lpad((500000 + n)::text, 6, '0'), customer_id, 'Bench', 'Bike ' || n
from bench_customers;

create temporary table bench_products on commit drop as
select gen_random_uuid() as id, g as n, round((5 + random() * 95)::numeric, 2) as cost
from generate_series(1, 300) g;

insert into public.products (id, short_id, name, tracking_type, default_sale_price, default_direct_cost)
select id, 'P-' || lpad((500000 + n)::text, 6, '0'), 'Bench part ' || n, 'quantity',
       round(cost * 1.6, 2), cost
from bench_products;

create temporary table bench_jobs on commit drop as
select
  gen_random_uuid() as id,
  g as n,
  c.customer_id,
  c.bike_id,
  now() - interval '366 days' + ((g % 360) + random()) * interval '1 day' as ci,
  case g % 20
    when 0 then 'cancelled'
    when 1 then 'in_progress'
    when 2 then 'completed'
    else 'collected'
  end::public.work_order_status as status,
  case g % 3
    when 0 then '5a000000-0000-4000-8000-000000000002'::uuid
    when 1 then '5a000000-0000-4000-8000-000000000003'::uuid
  end as lead
from generate_series(1, 15000) g
join bench_customers c on c.n = 1 + (g % 3000);

insert into public.work_orders (
  id, job_number, customer_id, bike_id, lead_mechanic_id, status, requested_work, checked_in_at,
  status_changed_at, started_at, completed_at, ready_for_collection_at, collected_at, cancelled_at,
  cancellation_reason, currency
)
select
  j.id,
  'J-' || lpad((500000 + j.n)::text, 6, '0'),
  j.customer_id,
  j.bike_id,
  j.lead,
  j.status,
  'Bench job',
  j.ci,
  j.ci + interval '3 days',
  case when j.status <> 'cancelled' then j.ci + interval '2 hours' end,
  case when j.status in ('completed', 'collected') then j.ci + interval '1 day' end,
  case when j.status = 'collected' then j.ci + interval '1 day 1 hour' end,
  case when j.status = 'collected' then j.ci + interval '3 days' end,
  case when j.status = 'cancelled' then j.ci + interval '1 hour' end,
  case when j.status = 'cancelled' then 'Bench cancellation' end,
  'SGD'
from bench_jobs j;

-- 2 to 5 live lines per job that is not cancelled (about 50,000).
create temporary table bench_lines on commit drop as
select
  gen_random_uuid() as id,
  j.id as job_id,
  j.ci,
  k,
  case (j.n + k) % 3 when 0 then 'inventory' when 1 then 'service' else 'manual' end as kind,
  1 + ((j.n * 7 + k) % 300) as product_n
from bench_jobs j
cross join lateral generate_series(1, 2 + (j.n % 4)) k
where j.status <> 'cancelled';

insert into public.work_order_line_items (
  id, work_order_id, line_type, source_service_id, source_product_id, description_snapshot, quantity,
  unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency, created_at
)
select
  l.id,
  l.job_id,
  l.kind::public.line_type,
  case when l.kind = 'service' then (select s.id from public.services s order by s.name limit 1) end,
  case when l.kind = 'inventory' then p.id end,
  'Bench ' || l.kind || ' line',
  case when l.kind = 'inventory' then 1 + floor(random() * 3) else 1 end,
  case when l.kind = 'inventory' then round(p.cost * 1.6, 2) else round((20 + random() * 200)::numeric, 2) end,
  case when l.kind = 'inventory' then p.cost when l.kind = 'manual' then round((random() * 50)::numeric, 2) else 0 end,
  0.3000,
  'SGD',
  l.ci + interval '30 minutes'
from bench_lines l
join bench_products p on p.n = l.product_n;

-- 2,500 retail sales with 4 lines each (10,000 sale lines).
create temporary table bench_sales on commit drop as
select gen_random_uuid() as id, g as n, now() - interval '365 days' + (random() * interval '364 days') as at
from generate_series(1, 2500) g;

insert into public.sales (id, sale_number, source, recognized_at, status, currency)
select id, 'S-' || lpad((500000 + n)::text, 6, '0'), 'retail', at, 'recorded', 'SGD'
from bench_sales;

insert into public.sale_lines (
  id, sale_id, line_number, product_id, description_snapshot, quantity, unit_sale_price_snapshot,
  unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency, created_at
)
select gen_random_uuid(), s.id, k, p.id, 'Bench sale line', 1 + floor(random() * 2), round(p.cost * 1.6, 2),
       p.cost, 0.3000, 'SGD', s.at
from bench_sales s
cross join generate_series(1, 4) k
join bench_products p on p.n = 1 + ((s.n * 7 + k) % 300);

-- Movements: one consumption per inventory line, one sale per sale line,
-- the rest stock adjustments (about 100,000 in all).
insert into public.inventory_movements (
  product_id, location_id, quantity_delta, movement_type, work_order_id, work_order_line_item_id,
  unit_cost_snapshot, currency, created_at
)
select li.source_product_id, (select id from public.locations order by sort_order limit 1), -li.quantity::integer,
       'job_consumption', li.work_order_id, li.id, li.unit_direct_cost_snapshot, 'SGD', li.created_at
from public.work_order_line_items li
join bench_lines bl on bl.id = li.id
where li.line_type = 'inventory';

insert into public.inventory_movements (
  product_id, location_id, quantity_delta, movement_type, sale_line_id, unit_cost_snapshot, currency,
  created_at
)
select sl.product_id, (select id from public.locations order by sort_order limit 1), -sl.quantity::integer,
       'retail_sale', sl.id, sl.unit_direct_cost_snapshot, 'SGD', sl.created_at
from public.sale_lines sl
join bench_sales s on s.id = sl.sale_id;

insert into public.inventory_movements (
  product_id, location_id, quantity_delta, movement_type, currency, reason, created_at
)
select p.id, (select id from public.locations order by sort_order limit 1),
       case when random() < 0.8 then 5 + floor(random() * 20)::int else -(1 + floor(random() * 3)::int) end,
       'stock_adjustment', 'SGD', 'Bench count', now() - (random() * interval '365 days')
from generate_series(1, 72000) g
join bench_products p on p.n = 1 + (g % 300);

-- 500 receipts with 4 lines each (2,000 receipt lines).
create temporary table bench_pos on commit drop as
select gen_random_uuid() as po_id, gen_random_uuid() as receipt_id, g as n,
       now() - interval '360 days' + (random() * interval '355 days') as at
from generate_series(1, 500) g;

insert into public.purchase_orders (id, po_number, supplier_id, status, currency, submitted_at, received_at)
select po_id, 'PO-' || lpad((500000 + n)::text, 6, '0'), (select id from public.suppliers limit 1),
       'received', 'SGD', at - interval '1 day', at
from bench_pos;

create temporary table bench_po_lines on commit drop as
select gen_random_uuid() as id, po.po_id, po.receipt_id, po.at, k, p.id as product_id, p.cost
from bench_pos po
cross join generate_series(1, 4) k
join bench_products p on p.n = 1 + ((po.n * 13 + k) % 300);

insert into public.purchase_order_lines (id, purchase_order_id, product_id, quantity_ordered, unit_cost, currency)
select id, po_id, product_id, 10, cost, 'SGD' from bench_po_lines;

insert into public.purchase_receipts (id, purchase_order_id, idempotency_key, received_at, received_by)
select receipt_id, po_id, gen_random_uuid(), at, '5a000000-0000-4000-8000-000000000001' from bench_pos;

insert into public.purchase_receipt_lines (
  id, purchase_receipt_id, purchase_order_line_id, product_id, location_id, line_number,
  quantity_received, unit_cost_actual, currency, created_at
)
select gen_random_uuid(), receipt_id, id, product_id, (select id from public.locations order by sort_order limit 1),
       k, 10, cost, 'SGD', at
from bench_po_lines;

insert into public.inventory_movements (
  product_id, location_id, quantity_delta, movement_type, purchase_receipt_line_id, unit_cost_snapshot,
  currency, created_at
)
select prl.product_id, prl.location_id, prl.quantity_received, 'purchase_received', prl.id,
       prl.unit_cost_actual, 'SGD', prl.created_at
from public.purchase_receipt_lines prl
join bench_pos po on po.receipt_id = prl.purchase_receipt_id;

commit;
analyze;

select
  (select count(*) from public.work_orders) as jobs,
  (select count(*) from public.work_order_line_items) as work_order_lines,
  (select count(*) from public.sale_lines) as sale_lines,
  (select count(*) from public.inventory_movements) as movements,
  (select count(*) from public.purchase_receipt_lines) as receipt_lines;

-- ===========================================================================
-- 2. Period reports (as the seeded admin: auth.uid() decides D30)
-- ===========================================================================
select set_config(
  'request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false
);
select (private.shop_today() - 29)::text as month_from, (private.shop_today() - 364)::text as year_from,
       private.shop_today()::text as to_day
\gset

\echo '--- summary: month and year, each basis'
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'month_from', :'to_day', 'sale');
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'year_from', :'to_day', 'sale');
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'month_from', :'to_day', 'check_in');
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'year_from', :'to_day', 'check_in');
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'month_from', :'to_day', 'completion');
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'year_from', :'to_day', 'completion');
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'month_from', :'to_day', 'collection');
explain (analyze, buffers, summary on) select * from public.report_period_summary(:'year_from', :'to_day', 'collection');

\echo '--- series: month by day, year by day and by month'
explain (analyze, buffers, summary on) select * from public.report_period_series(:'month_from', :'to_day', 'sale', 'day');
explain (analyze, buffers, summary on) select * from public.report_period_series(:'year_from', :'to_day', 'sale', 'day');
explain (analyze, buffers, summary on) select * from public.report_period_series(:'year_from', :'to_day', 'check_in', 'month');

\echo '--- breakdown: month and year'
explain (analyze, buffers, summary on) select * from public.report_breakdown(:'month_from', :'to_day', 'sale', 'job', 51);
explain (analyze, buffers, summary on) select * from public.report_breakdown(:'year_from', :'to_day', 'sale', 'job', 51);
explain (analyze, buffers, summary on) select * from public.report_breakdown(:'year_from', :'to_day', 'completion', 'product', 51);
explain (analyze, buffers, summary on) select * from public.report_breakdown(:'year_from', :'to_day', 'collection', 'mechanic', 51);
explain (analyze, buffers, summary on) select * from public.report_breakdown(:'year_from', :'to_day', 'check_in', 'category', 51);

\echo '--- line items: first page, a page 40,000 lines deep in a year, a key drill-down'
explain (analyze, buffers, summary on) select * from public.report_line_items(:'year_from', :'to_day', 'sale', null, null, 101);
select r.basis_at::text as deep_at, r.source_line_id::text as deep_id
from private.report_rows(:'year_from'::date, :'to_day'::date, 'sale') r
order by r.basis_at desc, r.source_line_id desc offset 40000 limit 1
\gset
explain (analyze, buffers, summary on)
  select * from public.report_line_items(:'year_from', :'to_day', 'sale', null, null, 101, :'deep_at', :'deep_id');
explain (analyze, buffers, summary on)
  select * from public.report_line_items(:'month_from', :'to_day', 'sale', 'channel', 'workshop', 101);

\echo '--- activity and stock value'
explain (analyze, buffers, summary on) select * from public.report_activity(:'month_from', :'to_day');
explain (analyze, buffers, summary on) select * from public.report_activity(:'year_from', :'to_day');
explain (analyze, buffers, summary on) select * from public.report_activity_by_mechanic(:'year_from', :'to_day');
explain (analyze, buffers, summary on) select * from public.report_stock_value();

-- ===========================================================================
-- 3. Reconciliation and exceptions (Phase 9 step 3; D106-D108)
-- ===========================================================================
-- About 3,000 unique units across their states, each with a consistent
-- ledger (owner inserts in replica mode, as in section 1): 40% available,
-- 20% sold by a retail sale, 20% sold on a completed bench job, 10% held on
-- an open bench job, 10% written off. Targets: both reconciliation RPCs and
-- operational_exceptions under 500 ms; report_exception_counts and
-- today_dashboard under 150 ms each (Today loads them every time).
reset role;
begin;
set local session_replication_role = replica;

create temporary table bench_uproducts on commit drop as
select gen_random_uuid() as id, g as n from generate_series(1, 300) g;

insert into public.products (id, short_id, name, tracking_type, default_sale_price, default_direct_cost)
select id, 'P-' || lpad((600000 + n)::text, 6, '0'), 'Bench bike ' || n, 'unique', 900, 500
from bench_uproducts;

create temporary table bench_units on commit drop as
select
  gen_random_uuid() as id,
  g as n,
  p.id as product_id,
  case g % 10
    when 0 then 'sold_sale' when 1 then 'sold_sale'
    when 2 then 'sold_job' when 3 then 'sold_job'
    when 4 then 'held'
    when 5 then 'written_off'
    else 'available'
  end as state,
  gen_random_uuid() as line_id,
  now() - interval '200 days' + (g % 150) * interval '1 day' as received_at
from generate_series(1, 3000) g
join bench_uproducts p on p.n = 1 + (g % 300);

insert into public.inventory_units (id, short_id, product_id, location_id, status, sold_at, direct_cost)
select u.id, 'U-' || lpad((600000 + u.n)::text, 6, '0'), u.product_id,
       (select id from public.locations order by sort_order limit 1),
       (case u.state
          when 'sold_sale' then 'sold' when 'sold_job' then 'sold'
          when 'held' then 'held_for_customer' when 'written_off' then 'written_off'
          else 'available'
        end)::public.unit_status,
       case when u.state in ('sold_sale', 'sold_job') then u.received_at + interval '20 days' end,
       500
from bench_units u;

insert into public.inventory_movements (
  product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason, unit_cost_snapshot,
  currency, created_at
)
select u.product_id, u.id, (select id from public.locations order by sort_order limit 1), 1, 'stock_adjustment',
       'Bench intake', 500, 'SGD', u.received_at
from bench_units u;

-- Retail sales, one line each.
insert into public.sales (id, sale_number, source, recognized_at, status, currency)
select u.line_id, 'S-' || lpad((600000 + u.n)::text, 6, '0'), 'retail', u.received_at + interval '20 days',
       'recorded', 'SGD'
from bench_units u where u.state = 'sold_sale';

insert into public.sale_lines (
  id, sale_id, line_number, product_id, inventory_unit_id, description_snapshot, quantity,
  unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency, created_at
)
select u.line_id, u.line_id, 1, u.product_id, u.id, 'Bench bike sale', 1, 900, 500, 0.3000, 'SGD',
       u.received_at + interval '20 days'
from bench_units u where u.state = 'sold_sale';

update public.inventory_units iu set sold_sale_line_id = u.line_id
from bench_units u where u.id = iu.id and u.state = 'sold_sale';

insert into public.inventory_movements (
  product_id, inventory_unit_id, location_id, quantity_delta, movement_type, sale_line_id, unit_cost_snapshot,
  currency, created_at
)
select u.product_id, u.id, (select id from public.locations order by sort_order limit 1), -1, 'retail_sale',
       u.line_id, 500, 'SGD', u.received_at + interval '20 days'
from bench_units u where u.state = 'sold_sale';

-- Job parts: sold on a completed bench job, or held on an open one.
create temporary table bench_unit_jobs on commit drop as
select u.id as unit_id, u.product_id, u.line_id, u.state, u.received_at,
       (select w.id from public.work_orders w
         where w.job_number like 'J-5%'
           and w.status = case when u.state = 'held' then 'in_progress' else 'collected' end::public.work_order_status
         order by w.job_number offset (u.n % 500) limit 1) as work_order_id
from bench_units u where u.state in ('sold_job', 'held');

insert into public.work_order_line_items (
  id, work_order_id, line_type, source_product_id, source_inventory_unit_id, description_snapshot, quantity,
  unit_sale_price_snapshot, unit_direct_cost_snapshot, cult_commons_rate_snapshot, currency, created_at
)
select j.line_id, j.work_order_id, 'inventory', j.product_id, j.unit_id, 'Bench bike part', 1, 900, 500,
       0.3000, 'SGD', j.received_at + interval '10 days'
from bench_unit_jobs j;

insert into public.inventory_movements (
  product_id, inventory_unit_id, location_id, quantity_delta, movement_type, work_order_id,
  work_order_line_item_id, unit_cost_snapshot, currency, created_at
)
select j.product_id, j.unit_id, (select id from public.locations order by sort_order limit 1), -1,
       'job_consumption', j.work_order_id, j.line_id, 500, 'SGD', j.received_at + interval '10 days'
from bench_unit_jobs j;

-- Write-offs.
insert into public.inventory_movements (
  product_id, inventory_unit_id, location_id, quantity_delta, movement_type, reason, unit_cost_snapshot,
  currency, created_at
)
select u.product_id, u.id, (select id from public.locations order by sort_order limit 1), -1, 'damaged',
       'Bench write-off', 500, 'SGD', u.received_at + interval '5 days'
from bench_units u where u.state = 'written_off';

commit;
analyze;

select
  (select count(*) from public.inventory_units) as units,
  (select count(*) from public.inventory_movements where inventory_unit_id is not null) as unit_movements;

select set_config(
  'request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', false
);

\echo '--- reconciliation: issues only, then everything'
explain (analyze, buffers, summary on) select * from public.report_stock_reconciliation();
explain (analyze, buffers, summary on) select * from public.report_unit_reconciliation();
explain (analyze, buffers, summary on) select * from public.report_stock_reconciliation(false, null, 1000);
explain (analyze, buffers, summary on) select * from public.report_unit_reconciliation(false, null, 1000);
select issue, count(*) from reporting.unit_reconciliation group by issue order by issue;
select issue, count(*) from reporting.stock_reconciliation group by issue order by issue;

\echo '--- exceptions: the list, the counts and Today'
explain (analyze, buffers, summary on) select * from public.operational_exceptions(200);
explain (analyze, buffers, summary on) select * from public.report_exception_counts();
explain (analyze, buffers, summary on) select * from public.today_dashboard(null);
select * from public.report_exception_counts();
