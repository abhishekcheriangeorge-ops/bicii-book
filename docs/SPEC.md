<!-- Source: BICII_Definitive_Agent_Build_Specification.docx, v1.0, 3 October 2026. Converted verbatim; this is the authoritative brief. -->

BICII
Workshop, Inventory, Consignment, Appointments & Operations System
Definitive implementation brief for coding agent | Version 1.0 | 3 October 2026
AUTHORITATIVE BUILD BRIEF. This document consolidates the complete product discussion into one specification. Treat the business rules, boundaries, invariants and acceptance criteria as requirements. Where implementation detail is not prescribed, choose the simplest robust design that preserves them.
# 1. Mission
Build a new internal operational application for BICII, a custom bicycle shop. BICII already has a public website in an existing repository. Do not rebuild or replace it. Build the operational application in a new repository, use the existing website as the visual reference, and make both applications clients of the same backend.
Workshop intake, work orders, mechanic assignment and permanent bicycle service history.
Customers, bicycles, appointments, shop hours and workshop intake capacity.
Shop-owned and consignment inventory; unique items and quantity stock.
QR identity and label printing from phone/iPad workflows.
Services, parts, job costing and Cult Commons yield share.
Suppliers, purchase orders, partial receiving and stock movement history.
Consignment settlement ledgers.
Daily/weekly/monthly operational and financial reporting.
Shopify integration while BICII remains operational source of truth.
Shared backend for later customer-facing appointments, My Bikes, service history and public products.
# 2. Non-negotiable principles
One operational truth: the database is authoritative.
History over overwrites: meaningful changes create events or ledger entries.
Financial snapshots: historical jobs/sales never change because catalog values change.
Inventory ledger: every stock change has a reason.
Stable physical identity for bikes and unique items.
Mobile-first shop-floor UX with minimal taps and typing.
Security is enforced in the data/service layer, not by hiding UI.
Extensible but not overbuilt: no ERP/accounting/complex SSO in MVP.
Idempotent integrations and mutations: retries cannot duplicate stock or sales.
Transactional invariants: multi-record financial/stock operations succeed or fail atomically.
# 3. Architecture
Existing BICII public website
        |
        v
SHARED SUPABASE BACKEND
PostgreSQL | Auth | Storage | RLS
        ^
        |
New BICII Admin PWA
workshop | inventory | consignment | purchasing | reports
        |
        +---- Shopify integration ----> Shopify
The public website and Admin are two clients of one backend, not separate business databases.
## 3.1 Stack
TypeScript end-to-end.
React/Next.js unless repository inspection establishes a better compatible choice.
Supabase PostgreSQL, Auth, Storage and RLS.
Migrations and generated database types in source control.
Server-side/service-layer validation for stock, money, settlement and integration mutations.
Installable responsive PWA.
Vercel acceptable initially; avoid unnecessary vendor lock-in.
## 3.2 Agent startup instructions
Inspect the existing BICII website repository for framework, typography, spacing, colors, design tokens and components.
Work in the new Admin repository; do not merge Admin into the public-site codebase.
Write a short architecture decision record covering validation, data access, migrations, testing and Supabase client/server boundaries.
Build schema/domain services before broad UI.
Use separate environment configuration and never commit secrets.
# 4. Identity, roles and security
Administrator: full workshop, inventory, costs, consignment, reporting, staff and configuration access.
Staff/Mechanic: operational jobs, intake, notes/photos, parts/services, scanning and labels; financial visibility permission-controlled.
Customer: Supabase-authenticated user who can later access own bikes, appointments and customer-visible service history through public site.
Anonymous: only explicitly public product/item information.
Use UUIDs internally. Email is never a foreign key.
## 4.1 Customer auth
MVP uses Supabase email authentication for BICII customers. Do not implement Shopify SSO now. Customer records support both nullable auth_user_id and nullable shopify_customer_id. Email may suggest a link but the persisted Shopify ID is the durable association.
customers
id uuid PK
auth_user_id uuid nullable unique
first_name, last_name, display_name nullable
email, phone nullable
internal_notes nullable
shopify_customer_id nullable unique
created_at, updated_at, archived_at nullable
## 4.2 RLS and permissions
Customers can access only their permitted records.
Anonymous users access only explicit public projections/views.
Costs, yield, Cult Commons figures, consignee values and internal notes are never public/customer-readable.
Staff authorization requires active staff membership plus permissions.
Privileged inventory/financial mutations are server/RPC/service validated.
Design granular permissions: view_costs, manage_inventory, adjust_stock, manage_consignments, manage_purchasing, manage_staff, view_financial_reports.
# 5. Bicycles
A bicycle is permanent; each visit creates a new work order.
bikes
id uuid PK
customer_id nullable
inventory_unit_id nullable
brand, model
variant, frame_size, colour, serial_number nullable
description, internal_notes nullable
created_at, updated_at, archived_at nullable
Multiple bikes per customer and multiple photos per bike.
Bikes may exist without a customer when shop-owned or consigned.
Service history is the chronological set of linked work orders.
Ownership changes preserve history instead of rewriting it.
Search by customer, brand/model, serial number and BICII ID.
# 6. Appointments
Appointments are core. Initially they reserve workshop intake capacity, not total repair duration. Customers do not select mechanics in MVP.
Customer signs in
 -> chooses appointment type
 -> chooses available slot within shop hours/capacity
 -> books
 -> Admin sees appointment
 -> customer arrives
 -> Check In
 -> select/create bicycle
 -> create/link work order
Walk-ins skip appointment booking and proceed directly to intake.
shop_hours: weekday, opens_at, closes_at, active
closure_overrides: starts_at, ends_at, reason, closed/custom_hours
appointment_types: name, duration_minutes, capacity_units, public, active
appointments:
 id, customer_id, bike_id nullable, appointment_type_id,
 starts_at, ends_at, status, customer_note, internal_note,
 created_at, updated_at
Suggested statuses: booked, confirmed, arrived, checked_in, completed, cancelled, no_show. Prevent overbooking transactionally. Schema must later support mechanic working hours, leave, skills and mechanic-specific availability.
# 7. Workshop work orders
work_orders
id uuid PK
job_number human-friendly unique
customer_id, bike_id
appointment_id nullable
lead_mechanic_id nullable
status
intake_notes, internal_notes, completion_notes
checked_in_at
started_at, completed_at, ready_for_collection_at, collected_at nullable
created_by, created_at, updated_at
Suggested statuses: received, diagnosing, awaiting_customer, awaiting_parts, ready_to_start, in_progress, paused, completed, ready_for_collection, collected, cancelled. Completed and collected are distinct.
## 7.1 Intake
Find/create customer.
Find/create bicycle.
Capture multiple intake photos from phone.
Record condition and requested work.
Create job number.
Assign lead mechanic and optional additional staff.
Add known services/parts.
Write timeline events.
Customer approval of extra work happens offline. No customer approval workflow is required; an optional internal approval note/flag is sufficient.
## 7.2 Mechanics and board
A job supports one lead mechanic plus multiple additional staff through an assignment relation. Provide My Jobs, unassigned jobs, reassignment and assignment history.
Workshop views should efficiently cover Received, Waiting, Ready, In Progress, Completed and Ready for Collection. Filters: mechanic, status, date, age/overdue, customer, bike and job number. Kanban is optional; mobile usability is mandatory.
## 7.3 Timeline
work_order_events
id, work_order_id, event_type
actor_staff_id/user_id
payload jsonb
created_at
Events include check-in, photos, assignments, diagnosis/notes, line changes, stock consumption/reversal, work start, status changes, completion and collection. updated_at is not an audit log.
# 8. Attachments and photos
attachments
id
entity_type, entity_id
storage_path, media_type
caption nullable
visibility: internal | customer | public
created_by, created_at
Use Supabase Storage and support direct mobile camera capture. Storage policies must enforce visibility.
# 9. Services and job line items
services
id, name, description
default_sale_price
default_direct_cost
category_id nullable
active, public
Examples: Basic Service, Full Service, Wheel True, Brake Bleed, Bike Build, Drivetrain Service, Tyre Installation and Custom Labour.
work_order_line_items
id, work_order_id
line_type: service | inventory | manual
source_service_id nullable
source_product_id nullable
source_inventory_unit_id nullable
description_snapshot
quantity
unit_sale_price_snapshot
unit_direct_cost_snapshot
sale_total, cost_total, yield_total, cult_commons_share
created_at
voided_at nullable, void_reason nullable
Every line snapshots its economics. Catalog changes never alter historical jobs. If an inventory line consumed stock, voiding/reducing it creates a reversing movement; never delete the evidence.
# 10. Cult Commons rule - critical
Cult Commons receives 30% of YIELD, not 30% of gross sales.
sale = quantity * unit_sale_price
direct_cost = quantity * unit_direct_cost
yield = sale - direct_cost
cult_commons_share = max(yield, 0) * 0.30
BICII_yield_after_CC = yield - cult_commons_share
$200 service, $0 direct cost -> $200 yield -> $60 Cult Commons.
$800 parts, $400 cost -> $400 yield -> $120 Cult Commons.
Combined $1,000 job with $400 cost -> $600 yield -> $180 Cult Commons.
$1,000 consignment bike with $500 owed to consignor -> $500 yield -> $150 Cult Commons.
Anything with direct cost has that cost deducted before the 30%. Consignor payout is COGS. Make the rate configurable/effective-dated, while historical line calculations remain snapshots. Negative yield reports a loss and does not create a negative Cult Commons payment unless a later explicit rule changes this.
# 11. Catalog and inventory
Separate catalog identity from physical stock identity.
Quantity tracked: e.g. 34 identical brake pads. One product/SKU, quantity balance, same QR can be printed repeatedly.
Unique tracked: e.g. used Colnago or one-off wheelset. Individual physical inventory unit, condition, unique ID and unique QR.
If one bulk unit becomes individually special, decrement bulk by one and create a new unique item; do not build complex conversion machinery.
products
id, sku, name, description
brand nullable, category_id nullable
tracking_type: quantity | unique
publication_status, public_slug
default_sale_price nullable
shopify_product_id nullable
shopify_variant_id nullable
active, created_at, updated_at
Support inventory locations even if MVP begins with one shop. Ownership types include shop_owned and consignment; leave a safe path for customer_owned/workshop-held property without making it saleable.
# 12. Inventory movement ledger - critical
inventory_movements
id
product_id
inventory_unit_id nullable
location_id
quantity_delta
movement_type
work_order_id nullable
sale_reference nullable
purchase_receipt_id nullable
consignment_id nullable
reversal_of_id nullable
unit_cost_snapshot nullable
notes nullable
created_by, created_at
Movement types: purchase_received, job_consumption, retail_sale, online_sale, stock_adjustment, damaged, return, consignment_received, consignment_returned, transfer, reversal.
Current stock must be derivable/reconcilable from movements. Cached balances are allowed only as projections.
A work-order part consumes stock exactly once. Retrying cannot consume it twice.
A unique item cannot be available in two states/locations simultaneously or sold twice.
All multi-record stock mutations are transactional.
# 13. Consignment
Consignment is first-class for complete bikes, frames, wheelsets, components and accessories.
Record consignor, item, received date, agreed amount owed, asking/sale price, status, added services/costs, sale reference and settlement status.
Agreed amount owed to consignor is direct COGS for yield calculation.
Selling does not mean the consignor has been paid.
consignment_settlements
id, consignor_id, amount, paid_at, reference, notes, created_by

settlement_lines
settlement_id, consignment_item_id, amount_applied
Each consignor gets a ledger showing active items, sold awaiting settlement, amount owed, amount paid, outstanding and settlement history. Support partial settlements.
# 14. Suppliers and purchasing
suppliers
id, name, contact_name, email, phone, website,
account_reference, notes

purchase_orders / purchase_order_lines
purchase_receipts / receipt_lines
Store ordered quantity, expected date and unit cost.
Support partial receipts: ordered 20, received 18, 2 remain outstanding.
Receiving creates stock movements and establishes actual cost.
Prevent duplicate receipt processing.
Allow future multiple supplier relationships per product.
# 15. QR identity and public/staff views
Every public-capable product/unique item has a stable BICII URL/identifier. QR contains only that URL/ID, never sensitive financial data.
Anonymous scan shows approved name, photos, description/specifications, price, availability and purchase action. Authenticated staff scanning the same QR additionally sees stock/location, cost, ownership/consignor, internal notes, movement history, edit actions, label printing, Shopify state and Cult Commons economics.
Public visibility must be explicit: draft/internal_only/public/sold/archived or an equivalent state machine. Inventory rows are not automatically public.
# 16. Label printing
From phone/iPad: open product -> Print Label -> choose quantity -> choose printer/profile -> print.
Default label should support item name, sale price, BICII short ID/SKU and QR. Unique bikes may include additional identity text.
Bulk stock: print N identical labels with the same QR.
Unique item: print its unique label.
Do not hard-code a printer protocol before inspecting BICII's actual label printers.
Create a printing abstraction: LabelTemplate, PrintJob, PrinterProfile/PrinterAdapter.
Browser print/PDF is the fallback. Native/network/Bluetooth adapters can be added once hardware is known.
# 17. Shopify boundary
BICII owns operational truth. Shopify owns commerce execution.
BICII owns product operational data, stock, direct cost, consignment, yield, Cult Commons calculations and workshop data.
Shopify handles online checkout, payment, orders, refunds, shipping and commerce infrastructure.
A BICII product can be marked Publish Online and synchronized to Shopify.
Persist Shopify product, variant, inventory/customer/order IDs. Do not repeatedly match by name/email.
Do not scatter Shopify API calls through UI components; isolate them in an integration/service layer.
## 17.1 Inbound events
Store every webhook/event before processing, keyed by provider event/topic and unique ID. Processing must be idempotent.
Shopify order paid
 -> persist/dedupe webhook
 -> map Shopify variant to BICII item
 -> create BICII sale reference
 -> create inventory movement exactly once
 -> mark unique item sold if applicable
 -> calculate/store internal economics
 -> update reporting projections
Refund/cancel behavior must be explicit. Do not automatically make a unique item available again unless the physical return/re-stock rule is satisfied.
## 17.2 Customer linking
MVP keeps Supabase customer login and Shopify customer login separate. Store shopify_customer_id on the BICII customer when safely linked. Same email can be a candidate, not proof. Build unified SSO only later.
# 18. Existing public BICII website integration
The current public website remains its own repo. Later add customer-facing modules there against the shared backend:
Supabase customer sign-in/sign-up.
Book/cancel/view appointments.
My Bikes.
Customer-visible service history.
Public product/item pages used by QR codes.
Online-buy actions that hand commerce execution to Shopify.
Do not duplicate business rules in the public app. Financial/stock rules live in backend/domain services.
# 19. Reporting
Reporting is designed from day one because structured operational events make it cheap and trustworthy.
## 19.1 Daily dashboard
Appointments today, arrivals and no-shows.
Jobs checked in, started, in progress, waiting, completed, ready for collection and collected.
Gross sales/value recorded for the day.
Direct COGS.
Yield.
Cult Commons share.
BICII yield after Cult Commons.
Parts consumed and significant stock adjustments.
Consignment sales and new settlement liabilities.
Low-stock items and operational exceptions.
## 19.2 Period views
Allow day/week/month/custom range and drill-down by job, product/category, service, mechanic and ownership type where meaningful. Reports must distinguish operational dates: check-in date, completion date, collection date and sale/recognition date rather than pretending they are the same.
Build reports from SQL views/materialized views over source records. Do not create manually maintained report totals as a second truth.
# 20. Search and scanning
Global staff search should quickly find customer, bike, job, product/SKU, serial number, QR/short ID, consignor and supplier. QR scanning should deep-link directly to the relevant staff/public record. Optimize for phone camera scanning.
# 21. Key screens
Admin home / Today dashboard.
Workshop board and My Jobs.
New intake / walk-in flow.
Work-order detail with timeline, photos, assignments and running line totals.
Customers and customer detail.
Bikes and bike detail/service history.
Appointments calendar/list and shop-hours settings.
Products/inventory list, product detail and unique-item detail.
QR/label print flow.
Inventory movements and stock adjustment.
Consignors, consignment items and settlement ledger.
Suppliers, purchase orders and receiving.
Reports.
Staff/permissions and settings.
Shopify sync status/errors.
# 22. UX rules
Phone-first controls with large tap targets.
Camera and scan actions prominent.
Autosave drafts where data loss would be painful, but financial/stock commits require explicit actions.
Use searchable pickers for large catalogs; never giant dropdowns.
Show current stock beside parts when adding to jobs.
Show running sale, cost/yield (if permitted) and job total without obscuring operational work.
Destructive actions require reason and create audit/reversal records.
Useful empty/loading/error states.
Fast keyboard operation on desktop/iPad where practical.
# 23. Domain invariants the database/service layer must enforce
A unique inventory unit cannot be sold twice.
A stock-consuming work-order line cannot consume inventory twice.
Voiding a consumed line creates a linked reversal rather than erasing the original movement.
A Shopify webhook can be processed repeatedly without duplicating business effects.
Historical line price/cost/yield snapshots do not change with catalog edits.
Consignment sale liability and consignment settlement are separate facts.
Settlement allocations cannot exceed the amount owed without an explicit override/business rule.
Customers cannot read internal notes, costs, yield, consignor or Cult Commons data.
Completed_at and collected_at represent different events.
Appointment booking cannot exceed configured capacity.
Receiving the same purchase receipt twice cannot double stock.
Every manual stock adjustment records actor, timestamp and reason.
Public QR pages expose only explicitly published records.
Archived entities remain available to historical references.
Financial values use fixed-precision decimal/numeric types, never floating point.
# 24. Money, dates and identifiers
Store money as PostgreSQL NUMERIC/DECIMAL with a documented precision/scale. Never JS floating-point arithmetic for authoritative totals.
Default currency is SGD, but model currency explicitly where external commerce may require it.
Store timestamps with timezone; display in Singapore local time by default.
Generate human-friendly job/product short IDs separately from UUID primary keys.
Do not recycle IDs.
# 25. Concurrency and transaction requirements
Use database transactions/RPCs/server transactions for checkout/sale ingestion, job part consumption, reversals, purchase receiving, unique-item status transitions, consignment sale creation and settlements. Lock/check affected stock records as necessary. UI optimism must never bypass authoritative validation.
# 26. Error handling and reconciliation
Integration failures go to a visible retry/error queue with human-readable reason.
Webhook raw metadata and processing state are retained for diagnosis.
Provide stock reconciliation tools comparing ledger-derived and cached balances.
Provide Shopify mapping/sync status per published product.
Never silently swallow a failed stock or financial mutation.
Use structured application logging with correlation/request IDs for critical mutations.
# 27. Testing requirements
## 27.1 Unit/domain tests
Cult Commons formulas for services, parts, consignment and losses.
Price/cost snapshot immutability.
Appointment capacity calculation.
Inventory movement/reversal rules.
Consignment outstanding balance and partial settlements.
Publication/permission decisions.
## 27.2 Integration/database tests
RLS: customer A cannot read customer B.
Anonymous cannot read costs/internal notes.
Mechanic permission boundaries.
Adding job part consumes exactly once.
Voiding restores through reversal exactly once.
Partial PO receipt adds correct stock.
Duplicate receipt request is idempotent.
Duplicate Shopify webhook has one business effect.
Unique item cannot be sold twice.
Consignment sale creates correct liability and yield.
## 27.3 End-to-end critical journeys
Walk-in bike -> intake photos -> job -> parts/services -> complete -> ready -> collected.
Appointment -> arrival -> check-in -> work order.
Create bulk product -> receive stock -> print 10 identical labels -> consume one on job.
Create unique consignment bike -> label -> public page -> sale -> Cult Commons calculation -> consignor outstanding -> partial/full settlement.
Publish BICII product to Shopify -> receive sale webhook -> stock changes once.
Customer signs in on public site and sees only own appointments/bikes/history once that frontend phase is built.
# 28. Seed/demo data
Development should include realistic seed data: several customers with multiple bikes; at least three mechanics; shop hours and appointment types; quantity parts; unique shop-owned and consignment bikes; services; supplier/PO with partial receipt; work orders in multiple statuses; sold/unsettled consignment; and reporting data spanning several days.
# 29. Implementation phases
Foundation: repo inspection, ADR, Supabase project/migrations, auth, roles/RLS, design tokens and app shell.
Customers, bicycles and attachments.
Appointments, shop hours, capacity and check-in.
Workshop: jobs, assignments, timeline, services and line items.
Inventory: products, unique units, locations, movement ledger and scanning.
Financial engine: cost snapshots, yield and Cult Commons calculations.
Consignment: intake, ownership, sales liability and settlement ledger.
Purchasing: suppliers, POs, partial receiving and costs.
QR/labels with printer abstraction and browser-print fallback.
Reporting/dashboard and reconciliation views.
Shopify outbound product sync and inbound idempotent webhooks.
Public-site integration in the existing website repo: auth, appointments, My Bikes, service history and public product pages.
Hardware-specific label-printer adapter after actual printer models/protocols are known.
Each phase should leave the application runnable and tested. Avoid a giant branch that implements everything before validation.
# 30. Explicitly out of MVP
Building a payment processor or replacing Shopify checkout.
Full accounting/general ledger, payroll or tax filing.
Automatic customer approval workflow for added workshop work.
Complex Shopify/BICII single sign-on.
Customer selection of a specific mechanic.
Sophisticated mechanic labor scheduling/time clock.
Complex bulk-to-unique conversion machinery.
Multi-location enterprise transfer optimization beyond a sound location/movement model.
Native mobile apps when the PWA is sufficient.
Hard-coded Bluetooth printer support before printer hardware is identified.
Marketing CRM, loyalty campaigns and automated messaging unless separately scoped.
# 31. Acceptance criteria for MVP
Staff can create/find a customer and bicycle and check a bike into a new job from a phone.
Staff can photograph intake condition, add notes and assign one lead plus additional mechanics.
Staff can add services and parts; the job shows correct running totals and immutable cost/yield snapshots.
Adding a part creates the correct stock movement exactly once; voiding it creates a linked reversal.
Jobs progress through statuses and retain a human-readable timeline; completed and collected are distinct.
Staff can create quantity products and unique items, assign ownership and print QR labels; bulk labels can be printed in arbitrary quantity.
Scanning a QR opens safe public information for anonymous users and richer internal information for authorized staff.
Consignment items track amount owed; sale computes yield correctly; settlement ledger supports partial payment.
Cult Commons is exactly 30% of positive yield after direct costs, including consignor cost.
Purchase orders can be partially received and receiving updates stock/cost correctly.
Appointments respect shop hours, closures and capacity; walk-ins still work.
Daily and period reports show jobs/activity plus sales, COGS, yield and Cult Commons share.
Shopify integration is isolated; duplicate webhook delivery cannot duplicate inventory effects.
RLS tests prove customers/public cannot access internal financial data.
Application is usable as an installable phone/iPad PWA and visually belongs to BICII.
# 32. Definition of done
A feature is not done merely because a screen renders. It is done when schema migration, authorization, domain validation, audit/ledger behavior, responsive UI, error handling and tests for the critical business rule are present. Critical stock and financial paths must be testable from seed data.
# 33. Guidance for agent autonomy
The agent may improve table normalization, naming, component structure and implementation mechanics. It may not silently change business semantics. If a design decision would change Cult Commons calculations, inventory ownership, consignment liability, historical financial snapshots, public/private boundaries or the one-backend/two-frontends architecture, stop and surface the decision rather than improvising.
# 34. Final product model
BICII CUSTOMER
  ├── appointments
  └── bicycles
       └── work orders
            ├── staff assignments
            ├── photos / notes / timeline
            └── services + inventory lines
                         |
                         v
                 inventory movement ledger

BICII INVENTORY
  ├── quantity products
  ├── unique items / bikes
  ├── shop-owned
  └── consignment
       └── consignor liability + settlement ledger

Every financial line:
  SALE - DIRECT COST = YIELD
  CULT COMMONS = 30% OF POSITIVE YIELD

BICII owns operational truth.
Shopify executes online commerce.
The existing BICII website becomes the customer-facing client.
The new BICII Admin PWA becomes the staff-facing client.
Both use the same secured backend.
# 35. First implementation milestone
The first milestone should prove the architecture end-to-end rather than build every module shallowly: Supabase migrations + RLS; staff login; customer and bicycle creation; phone intake with photo; work order; mechanic assignment; one service line; one quantity part line that consumes inventory through the ledger; correct yield/Cult Commons calculation; job status/timeline; completion and collection; and a basic Today dashboard. Once that vertical slice is reliable, expand into consignment, purchasing, labels, Shopify and public-site integration.