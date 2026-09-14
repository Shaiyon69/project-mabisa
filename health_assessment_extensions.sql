-- Project MABISA — health_assessments: vitals beyond BMI
--
-- Applied to the live project on 2026-09-14 as migration `health_assessment_vitals`.
-- Sickness selection is not here: it uses `primary_illness`/`illness_other`, already
-- added by migration `health_assessment_clinical_columns`.
--
-- Additive and nullable: not every visit takes every vital, and existing rows need no backfill.

alter table public.health_assessments
  add column if not exists systolic_bp smallint,
  add column if not exists diastolic_bp smallint,
  add column if not exists temperature_c numeric(4, 1),
  add column if not exists pulse_rate smallint;
