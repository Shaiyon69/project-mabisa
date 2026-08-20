import type { Individual } from '../types/database';

/**
 * Likely-duplicate detection for resident profiles.
 *
 * MABISA does not verify physical identity and never blocks a save on a suspected
 * duplicate — the BHW is standing in the household and is the one who can tell.
 * This only produces the warning they judge: a short list of records that look
 * like the person being registered, ordered most convincing first.
 *
 * Deliberately not fuzzy. Edit distance would need every candidate row in memory
 * and a threshold nobody has agreed, and it buys little against the case that
 * actually happens — the same person entered twice, spelled the same way, on two
 * visits. Normalisation covers the variation that does occur: casing, an accent
 * typed once and not the next time, a stray hyphen, doubled spaces.
 */

export type DuplicateConfidence = 'exact' | 'likely';

export type DuplicateMatch = {
  person: Individual;
  /** `exact` — names and birthday agree. `likely` — names agree, birthday does not. */
  confidence: DuplicateConfidence;
};

/** What a name is compared as: lowercase, unaccented, punctuation-free, single-spaced. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    // Combining marks, so "Muñoz" and "Munoz" are one name and "Peña" is not a
    // different person from "Pena".
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

/**
 * Records among `existing` that look like `candidate`, most convincing first.
 *
 * Middle name is not compared: it is optional on the form, so a blank one would
 * either miss real duplicates or manufacture false ones depending on which way
 * the comparison fell.
 */
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
