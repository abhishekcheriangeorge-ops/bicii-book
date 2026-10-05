-- Enum values Phase 2 needs before the migrations that use them (PLAN D40).
--
-- A new enum value cannot be used in the transaction that adds it, and every
-- migration runs in its own transaction, so it is added here on its own:
--   * work_order_event_type 'appointment_linked': the job's timeline entry
--     that says it was checked in from (or linked to) an appointment. Phase
--     2's work_orders trigger writes it (step 2, with check_in_appointment);
--     the staff timeline describes it (src/lib/workshop-timeline.ts) and the
--     customer timeline never shows it (D8).
alter type public.work_order_event_type add value if not exists 'appointment_linked';
