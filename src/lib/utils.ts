import type { NutritionStatus } from '../types/database';

export function calculateBmi(weightKg: number, heightCm: number): number | null {
  if (weightKg <= 0 || heightCm <= 0) {
    return null;
  }

  const heightMeters = heightCm / 100;
  return Number((weightKg / (heightMeters * heightMeters)).toFixed(2));
}

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

export function createId(): string {
  return crypto.randomUUID();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
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
