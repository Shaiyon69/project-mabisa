-- Project MABISA — health_assessments: vitals beyond BMI, sickness selection
--
-- NOT YET APPLIED. Written 2026-09-14 for docs/PANEL_REVISIONS_PLAN.md items A and C.
-- Run this against the Supabase project (SQL editor or `supabase migration new`), then
-- update this header with the applied date and migration name, per the pattern
-- `data_policies.sql` and `barangay_roles.sql` already follow.
--
-- All additive and nullable (or defaulted), so existing rows need no backfill.

alter table public.health_assessments
  add column if not exists systolic_bp smallint,
  add column if not exists diastolic_bp smallint,
  add column if not exists temperature_c numeric(4, 1),
  add column if not exists pulse_rate smallint,
  -- One visit can note more than one sickness; 'other' pairs with the free-text note.
  add column if not exists sicknesses text[] not null default '{}',
  add column if not exists sickness_other_note text;
