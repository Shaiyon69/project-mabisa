import type { Individual } from '../types/database';

/**
 * Likely-duplicate detection for resident profiles. Never blocks a save: the BHW
 * standing in the household is the one who can tell. Not fuzzy — normalization
 * covers the variation that occurs: casing, accents, hyphens, doubled spaces.
 */

type DuplicateConfidence = 'exact' | 'likely';

export type DuplicateMatch = {
  person: Individual;
  /** `exact` — names and birthday agree. `likely` — names agree, birthday does not. */
  confidence: DuplicateConfidence;
};

/** What a name is compared as: lowercase, unaccented, punctuation-free, single-spaced. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    // Combining marks, so "Muñoz" and "Munoz" are one name.
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    // Hyphens, apostrophes and periods are written inconsistently on paper forms.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type NameAndBirthday = {
  resident_id?: string;
  first_name: string;
  last_name: string;
  birthday: string;
};

/** Records among `existing` that look like `candidate`, most convincing first. Middle name is optional, so it is not compared. */
export function findLikelyDuplicates(candidate: NameAndBirthday, existing: Individual[]): DuplicateMatch[] {
  const first = normalizeName(candidate.first_name);
  const last = normalizeName(candidate.last_name);

  // A half-typed name matches half the barangay. Nothing to warn about yet.
  if (!first || !last) {
    return [];
  }

  const matches: DuplicateMatch[] = [];

  for (const person of existing) {
    // Editing a saved resident must not flag them against themselves.
    if (candidate.resident_id && person.resident_id === candidate.resident_id) {
      continue;
    }

    if (normalizeName(person.first_name) !== first || normalizeName(person.last_name) !== last) {
      continue;
    }

    matches.push({
      person,
      confidence: person.birthday === candidate.birthday ? 'exact' : 'likely',
    });
  }

  return matches.sort((left, right) => Number(right.confidence === 'exact') - Number(left.confidence === 'exact'));
}
