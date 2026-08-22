import { describe, expect, it } from 'vitest';
import { findLikelyDuplicates, normalizeName } from './duplicates';
import type { Individual } from '../types/database';

function resident(overrides: Partial<Individual> & Pick<Individual, 'resident_id' | 'first_name' | 'last_name' | 'birthday'>): Individual {
  return {
    household_id: 'household-1',
    middle_name: undefined,
    sex: 'female',
    is_household_head: false,
    occupation: null,
    educational_attainment: null,
    is_out_of_school_youth: false,
    is_pregnant_nursing_fp: false,
    philhealth_number: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeName', () => {
  it('folds the variation that actually happens on paper forms', () => {
    expect(normalizeName('  Maria   Cristina ')).toBe('maria cristina');
    expect(normalizeName('DELA CRUZ')).toBe('dela cruz');
    expect(normalizeName("D'Souza-Reyes")).toBe('d souza reyes');
    expect(normalizeName('Peña')).toBe(normalizeName('Pena'));
    expect(normalizeName('Muñoz')).toBe('munoz');
  });

  it('treats a missing name as empty rather than throwing', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});

describe('findLikelyDuplicates', () => {
  const existing = [
    resident({ resident_id: 'a', first_name: 'Juan', last_name: 'Dela Cruz', birthday: '1990-05-02' }),
    resident({ resident_id: 'b', first_name: 'Juan', last_name: 'Dela Cruz', birthday: '1974-11-30' }),
    resident({ resident_id: 'c', first_name: 'Juana', last_name: 'Dela Cruz', birthday: '1990-05-02' }),
  ];

  it('ranks a matching birthday above a differing one', () => {
    const matches = findLikelyDuplicates(
      { first_name: 'juan', last_name: 'DELA  CRUZ', birthday: '1990-05-02' },
      existing,
    );

    expect(matches.map((match) => [match.person.resident_id, match.confidence])).toEqual([
      ['a', 'exact'],
      ['b', 'likely'],
    ]);
  });

  it('does not match a different first name', () => {
    expect(findLikelyDuplicates({ first_name: 'Juana', last_name: 'Santos', birthday: '1990-05-02' }, existing)).toEqual(
      [],
    );
  });

  it('never flags a resident against their own saved record', () => {
    const matches = findLikelyDuplicates(
      { resident_id: 'a', first_name: 'Juan', last_name: 'Dela Cruz', birthday: '1990-05-02' },
      existing,
    );

    expect(matches.map((match) => match.person.resident_id)).toEqual(['b']);
  });

  it('stays quiet while a name is still half typed', () => {
    expect(findLikelyDuplicates({ first_name: 'Juan', last_name: '', birthday: '1990-05-02' }, existing)).toEqual([]);
    expect(findLikelyDuplicates({ first_name: '   ', last_name: 'Dela Cruz', birthday: '1990-05-02' }, existing)).toEqual(
      [],
    );
  });
});
