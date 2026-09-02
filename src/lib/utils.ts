import type { KeyboardEvent } from 'react';
import type { NutritionStatus } from '../types/database';

export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (weightKg <= 0 || heightCm <= 0) {
    return null;
  }

  const heightMeters = heightCm / 100;
  return Number((weightKg / (heightMeters * heightMeters)).toFixed(2));
}

/**
 * Absolute physical bounds on a field measurement, not a clinical judgement.
 * Outside these the entry is a slipped decimal point or the wrong unit. Wide
 * enough to hold a newborn and the tallest adult.
 */
export const WEIGHT_KG_RANGE = { min: 1, max: 300 };
export const HEIGHT_CM_RANGE = { min: 30, max: 250 };

/**
 * Whether a measurement typed into a form is one the app will record. Takes the
 * raw string, so blank, `-` and a half-typed exponent answer false here rather
 * than arriving as `NaN`. The save gate and the field's error message share it.
 */
export function isMeasurementInRange(value: string, range: { min: number; max: number }): boolean {
  const parsed = Number(value);

  return value.trim() !== '' && Number.isFinite(parsed) && parsed >= range.min && parsed <= range.max;
}

/**
 * Below this age the bands below classify nobody: WHO reads under-20s off
 * BMI-for-age z-scores instead. Every surface showing a status to someone who did
 * not take the measurement has to say so.
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

/** Blank optional text is stored as NULL rather than an empty string. */
export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Strips typed formatting, leaving the canonical digits, so one ID has one spelling. */
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
 * Whether a string is a real `YYYY-MM-DD` calendar date. The round trip is what
 * rejects `2026-02-31`, which `Date` silently rolls forward to March instead of
 * refusing. Guards the values that arrive from a URL rather than from a picker.
 */
export function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * A date that has not happened yet. Compared as strings, since `YYYY-MM-DD` sorts
 * as the calendar does and `new Date()` would read it as UTC midnight. The `max`
 * attribute stops the picker but not the keyboard, so this is the real guard.
 */
export function isInFuture(value: string | null | undefined, on: string = today()): boolean {
  if (!value) {
    return false;
  }

  return value.slice(0, 10) > on;
}

/**
 * The date to stamp on a member's status: today when it has just moved off
 * `active`, unchanged when it has not moved, and cleared on a return to `active`.
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
 * Compared as calendar parts, since `new Date()` would read the stored date as
 * UTC midnight and age a resident down by a day at the boundary.
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
 * Suppresses implicit submit from Enter inside a text field, so the Save button is
 * the only way in. A textarea keeps Enter, where it means a new line.
 */
export function ignoreImplicitSubmit(event: KeyboardEvent<HTMLFormElement>): void {
  const target = event.target as HTMLElement;

  if (event.key === 'Enter' && target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'submit') {
    event.preventDefault();
  }
}

/**
 * Brings the first failed field into view after a rejected submit, so the Save
 * button does not read as dead. `.form-alert` is matched too, since a whole-form
 * failure renders at the top. Runs on the next frame, once React has committed
 * the error nodes.
 */
export function scrollToFirstError(): void {
  requestAnimationFrame(() => {
    document.querySelector('.form-alert, .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

export function logDev(message: string, data?: unknown): void {
  if (import.meta.env.DEV) {
    console.info(`[BRHP-MSAM] ${message}`, data ?? '');
  }
}

/**
 * Key prefix for the household form's saved draft, one per account. Lives here
 * because the device-handover path has to clear every account's draft.
 */
export const HOUSEHOLD_DRAFT_PREFIX = 'mabisa.household_draft.';
