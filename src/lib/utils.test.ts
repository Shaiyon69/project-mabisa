import { describe, expect, it } from 'vitest';
import { ageInYears, calculateBmi, getNutritionStatus, titleCase } from './utils';

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
  // Adult cut-points only — see CLAUDE.md, children need DOH/NNC z-scores.
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
