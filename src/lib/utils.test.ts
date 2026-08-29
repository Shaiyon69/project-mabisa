import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  calculateBmi,
  getNutritionStatus,
  HEIGHT_CM_RANGE,
  isMeasurementInRange,
  sameHouseholdNumber,
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

describe('sameHouseholdNumber', () => {
  it('matches the same number written differently', () => {
    expect(sameHouseholdNumber('HH-001', ' hh-001 ')).toBe(true);
  });

  it('does not match a number that merely contains the other', () => {
    expect(sameHouseholdNumber('HH-001', 'HH-0012')).toBe(false);
  });

  it('treats a blank number as matching nothing, including another blank', () => {
    expect(sameHouseholdNumber('', '')).toBe(false);
    expect(sameHouseholdNumber(null, 'HH-001')).toBe(false);
  });
});
