import type { NutritionStatus } from '../types/database';

export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (weightKg <= 0 || heightCm <= 0) {
    return null;
  }

  const heightMeters = heightCm / 100;
  return Number((weightKg / (heightMeters * heightMeters)).toFixed(2));
}

/**
 * Absolute physical bounds on a field measurement — not a clinical judgement.
 * Outside these the entry is a slipped decimal point or the wrong unit, not a
 * reading, and an assessment built on one is worse than no assessment. Wide
 * enough to hold a newborn at one end and the tallest adult at the other, so
 * nothing real is refused.
 */
export const WEIGHT_KG_RANGE = { min: 1, max: 300 };
export const HEIGHT_CM_RANGE = { min: 30, max: 250 };

/**
 * Whether a measurement typed into a form is one the app will record.
 *
 * Takes the raw string rather than a number so blank, `-`, and a half-typed
 * exponent all answer false here instead of arriving as `NaN` further down. The
 * save gate and the field's error message both call this, because they used to
 * carry the bounds separately: the field drew "Enter a weight from 1 to 300 kg."
 * while the gate asked only for a positive number, so a 900 kg entry showed the
 * error and saved anyway.
 */
export function isMeasurementInRange(value: string, range: { min: number; max: number }): boolean {
  const parsed = Number(value);

  return value.trim() !== '' && Number.isFinite(parsed) && parsed >= range.min && parsed <= range.max;
}

/**
 * Below this age the four bands below classify nobody. WHO reads under-20s off
 * BMI-for-age z-scores instead, so the status a child's measurements produce here
 * is an adult reading printed against a child, not a finding. Every surface that
 * shows a status to someone who did not take the measurement has to say so.
 */
export const ADULT_BMI_MIN_AGE = 20;

export function getNutritionStatus(bmi: number | null): NutritionStatus | null {
  if (!bmi) {
    return null;
  }

  if (bmi < 18.5) {
    return 'underweight';
  }

  if (bmi < 25) {
    return 'normal';
  }

  if (bmi < 30) {
    return 'overweight';
  }

  return 'obese';
}

/**
 * Whether two household numbers name the same household. A device only ever holds
 * one purok, so the number alone is the identity — compared trimmed and
 * case-insensitively, because "hh-001" and "HH-001 " are one house on paper.
 */
export function sameHouseholdNumber(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';
  const normalized = normalize(left);

  return normalized !== '' && normalized === normalize(right);
}

/** Blank optional text is stored as NULL rather than an empty string. */
export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Strips the formatting a BHW typed, leaving the canonical digits — a PhilHealth
 * number written with dashes and one written without are the same ID.
 */
export function philhealthDigits(value: string | null | undefined): string | null {
  const digits = value?.replace(/[^0-9]/g, '');
  return digits ? digits : null;
}

export function createId(): string {
  return crypto.randomUUID();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The date to stamp on a member's status. A status that has just moved off
 * `active` is dated today; one that has not moved keeps the date it already
 * carried; returning to `active` clears it, because there is nothing to date.
 */
export function statusChangedOn(
  previous: string | null | undefined,
  next: string | null | undefined,
  existing: string | null | undefined,
  on: string = today(),
): string | null {
  if ((next ?? 'active') === 'active') {
    return null;
  }

  return next === previous ? existing ?? on : on;
}

/**
 * Whole years completed, so a birthday later this year has not counted yet.
 *
 * The stored date is compared as calendar parts rather than through `new Date()`:
 * a `YYYY-MM-DD` string parses as UTC midnight, which lands on the previous day
 * west of Greenwich and would age a resident down by a day at the boundary.
 */
export function ageInYears(birthday: string, on: Date = new Date()): number | null {
  const [year, month, day] = birthday.slice(0, 10).split('-').map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const monthDelta = on.getMonth() + 1 - month;
  const hasHadBirthday = monthDelta > 0 || (monthDelta === 0 && on.getDate() >= day);

  return on.getFullYear() - year - (hasHadBirthday ? 0 : 1);
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

/**
 * Brings the first failed field into view after a rejected submit.
 *
 * Field errors render beside their input, which on a long form is well above the
 * Save button the person just tapped — without this, a rejected submit looks
 * exactly like a dead button. `.form-alert` is matched too: a whole-form failure
 * renders at the top of the form and is therefore the first match in document
 * order. The callback runs on the next frame so React has committed the error
 * nodes before the query. Both class names are owned by `FormField.tsx`, which
 * cannot export this itself without tripping `react-refresh/only-export-components`.
 */
export function scrollToFirstError(): void {
  requestAnimationFrame(() => {
    document.querySelector('.form-alert, .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

export function logDev(message: string, data?: unknown): void {
  if (import.meta.env.DEV) {
    console.info(`[MABISA] ${message}`, data ?? '');
  }
}
