import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  calculateBmi,
  emptyToNull,
  getNutritionStatus,
  HEIGHT_CM_RANGE,
  isInFuture,
  isMeasurementInRange,
  philhealthDigits,
  statusChangedOn,
  titleCase,
  WEIGHT_KG_RANGE,
} from './utils';

describe('calculateBmi', () => {
  it('computes BMI in kg/m² from centimetres', () => {
    expect(calculateBmi(60, 160)).toBe(23.44);
  });

  it('rejects non-positive measurements instead of returning Infinity or NaN', () => {
    expect(calculateBmi(0, 160)).toBeNull();
    expect(calculateBmi(60, 0)).toBeNull();
    expect(calculateBmi(-5, 160)).toBeNull();
  });
});

describe('isMeasurementInRange', () => {
  it('accepts both ends of the range and rejects a step past either', () => {
    expect(isMeasurementInRange('1', WEIGHT_KG_RANGE)).toBe(true);
    expect(isMeasurementInRange('300', WEIGHT_KG_RANGE)).toBe(true);
    expect(isMeasurementInRange('0.9', WEIGHT_KG_RANGE)).toBe(false);
    expect(isMeasurementInRange('300.1', WEIGHT_KG_RANGE)).toBe(false);

    expect(isMeasurementInRange('30', HEIGHT_CM_RANGE)).toBe(true);
    expect(isMeasurementInRange('250', HEIGHT_CM_RANGE)).toBe(true);
    expect(isMeasurementInRange('29.9', HEIGHT_CM_RANGE)).toBe(false);
    expect(isMeasurementInRange('250.1', HEIGHT_CM_RANGE)).toBe(false);
  });

  it('rejects an entry that is not a number rather than passing NaN down', () => {
    expect(isMeasurementInRange('', WEIGHT_KG_RANGE)).toBe(false);
    expect(isMeasurementInRange('   ', WEIGHT_KG_RANGE)).toBe(false);
    expect(isMeasurementInRange('-', WEIGHT_KG_RANGE)).toBe(false);
    expect(isMeasurementInRange('60kg', WEIGHT_KG_RANGE)).toBe(false);
    expect(isMeasurementInRange('Infinity', WEIGHT_KG_RANGE)).toBe(false);
  });

  it('passes a plausible field reading, including a newborn', () => {
    expect(isMeasurementInRange('3.2', WEIGHT_KG_RANGE)).toBe(true);
    expect(isMeasurementInRange('49', HEIGHT_CM_RANGE)).toBe(true);
    expect(isMeasurementInRange('58.5', WEIGHT_KG_RANGE)).toBe(true);
    expect(isMeasurementInRange('161', HEIGHT_CM_RANGE)).toBe(true);
  });
});

describe('ageInYears', () => {
  // Decides whether the health assessment form flags the adult-BMI caveat, so the
  // day either side of a birthday is the case that matters.
  const on = new Date(2026, 7, 17);

  it('counts only birthdays that have already passed', () => {
    expect(ageInYears('2006-08-16', on)).toBe(20);
    expect(ageInYears('2006-08-17', on)).toBe(20);
    expect(ageInYears('2006-08-18', on)).toBe(19);
    expect(ageInYears('2006-12-01', on)).toBe(19);
  });

  it('returns null for an unparseable birthdate rather than NaN', () => {
    expect(ageInYears('', on)).toBeNull();
    expect(ageInYears('not-a-date', on)).toBeNull();
  });
});

describe('getNutritionStatus', () => {
  // Adult cut-points only — children need DOH/NNC z-scores.
  it('maps each band at its boundary', () => {
    expect(getNutritionStatus(18.49)).toBe('underweight');
    expect(getNutritionStatus(18.5)).toBe('normal');
    expect(getNutritionStatus(24.99)).toBe('normal');
    expect(getNutritionStatus(25)).toBe('overweight');
    expect(getNutritionStatus(29.99)).toBe('overweight');
    expect(getNutritionStatus(30)).toBe('obese');
  });

  it('returns null when there is no BMI to classify', () => {
    expect(getNutritionStatus(null)).toBeNull();
  });
});

describe('titleCase', () => {
  it('turns a snake_case enum value into a label', () => {
    expect(titleCase('severely_underweight')).toBe('Severely Underweight');
  });
});

describe('statusChangedOn', () => {
  it('dates a status that has just left active', () => {
    expect(statusChangedOn('active', 'moved_out', null, '2026-08-29')).toBe('2026-08-29');
  });

  it('keeps the date a standing status already carried', () => {
    expect(statusChangedOn('deceased', 'deceased', '2026-07-01', '2026-08-29')).toBe('2026-07-01');
  });

  it('clears the date when the member is active again', () => {
    expect(statusChangedOn('moved_out', 'active', '2026-07-01', '2026-08-29')).toBeNull();
  });
});

// Both are shared by the household form and the resident editor. They used to be
// a copy each, so a rule changed on one screen reached the other only by luck.
describe('emptyToNull', () => {
  it('stores blank optional text as NULL, not as an empty string', () => {
    expect(emptyToNull('')).toBeNull();
    expect(emptyToNull('   ')).toBeNull();
    expect(emptyToNull(null)).toBeNull();
    expect(emptyToNull(undefined)).toBeNull();
  });

  it('trims what was typed and keeps it', () => {
    expect(emptyToNull('  farmer ')).toBe('farmer');
  });
});

describe('philhealthDigits', () => {
  it('reduces the formatting a BHW typed to the digits that identify the card', () => {
    expect(philhealthDigits('12-345678901-2')).toBe('123456789012');
    expect(philhealthDigits('12 3456')).toBe('123456');
    // One ID must not be storable under two spellings.
    expect(philhealthDigits('12-3456')).toBe(philhealthDigits('123456'));
  });

  it('stores nothing rather than an empty string when no digits were given', () => {
    expect(philhealthDigits('')).toBeNull();
    expect(philhealthDigits('--')).toBeNull();
    expect(philhealthDigits(null)).toBeNull();
    expect(philhealthDigits(undefined)).toBeNull();
  });
});

describe('isInFuture', () => {
  it('accepts today and everything before it', () => {
    expect(isInFuture('2026-08-30', '2026-08-30')).toBe(false);
    expect(isInFuture('1980-04-05', '2026-08-30')).toBe(false);
  });

  it('rejects a date that has not happened yet', () => {
    expect(isInFuture('2026-08-31', '2026-08-30')).toBe(true);
    expect(isInFuture('2099-12-31', '2026-08-30')).toBe(true);
  });

  it('treats an unanswered date as nothing to complain about', () => {
    // Whether the field is required is a separate question, asked separately.
    expect(isInFuture('', '2026-08-30')).toBe(false);
    expect(isInFuture(null, '2026-08-30')).toBe(false);
    expect(isInFuture(undefined, '2026-08-30')).toBe(false);
  });

  it('compares the day, not the moment, so a timestamp does not read as tomorrow', () => {
    expect(isInFuture('2026-08-30T23:59:00Z', '2026-08-30')).toBe(false);
  });
});
