import { describe, expect, it } from 'vitest';
import { calculateBmi, getNutritionStatus, titleCase } from './utils';

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
