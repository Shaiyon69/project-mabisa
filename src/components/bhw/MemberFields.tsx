import type { ReactNode } from 'react';
import type { Individual, IndividualSex, RelationshipToHead } from '../../types/database';
import { RELATIONSHIPS_TO_HEAD } from '../../types/database';
import { titleCase, today } from '../../lib/utils';
import { FormField, SelectField } from '../common/FormField';
import { useBhwLanguage } from '../../app/bhwLanguage';

// The column is plain text with no check constraint, so a fixed list is safe here
// and keeps the registry searchable in a way free text would not.
const EDUCATION_OPTIONS = [
  { label: '(Not specified)', value: '' },
  { label: 'None', value: 'none' },
  { label: 'Elementary', value: 'elementary' },
  { label: 'High School', value: 'high_school' },
  { label: 'Senior High School', value: 'senior_high' },
  { label: 'Vocational', value: 'vocational' },
  { label: 'College', value: 'college' },
  { label: 'Post-graduate', value: 'post_graduate' }
];

/** One per-member yes/no, on the same target as every other choice in the app. */
export function MemberChoice({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`choice${checked ? ' is-checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

type MemberFieldsProps = {
  member: Partial<Individual>;
  onChange: (field: keyof Individual, value: unknown) => void;
  showValidation: boolean;
  /**
   * Choices that belong to the calling screen rather than to a person — the
   * household-head flag, which only means something while several members are
   * being entered together.
   */
  children?: ReactNode;
};

/**
 * The editable field set for one resident.
 *
 * Shared between household registration and the correction path on a saved
 * profile, because the two have to ask for the same things: a second copy of this
 * markup is how the two screens end up validating a birthday differently, or how
 * one of them quietly stops offering an education level the other still writes.
 */
export function MemberFields({ member, onChange, showValidation, children }: MemberFieldsProps) {
  const { t } = useBhwLanguage();

  return (
    <>
      <div className="field-row">
        {/* autoCapitalize is the phone keyboard's own behaviour for a name
            field; typing one lowercase surname per household is the kind of
            work the app should absorb rather than hand to the BHW. */}
        <FormField
          label={t('First Name')}
          value={member.first_name ?? ''}
          onChange={(event) => onChange('first_name', event.target.value)}
          required
          autoCapitalize="words"
          error={showValidation && !member.first_name?.trim() ? t('First name is required.') : undefined}
        />
        <FormField
          label={t('Middle Name')}
          value={member.middle_name ?? ''}
          onChange={(event) => onChange('middle_name', event.target.value)}
          placeholder="(Optional)"
          autoCapitalize="words"
        />
        <FormField
          label={t('Last Name')}
          value={member.last_name ?? ''}
          onChange={(event) => onChange('last_name', event.target.value)}
          required
          autoCapitalize="words"
          error={showValidation && !member.last_name?.trim() ? t('Last name is required.') : undefined}
        />
      </div>

      <div className="field-row">
        <FormField
          label={t('Birthdate')}
          type="date"
          max={today()}
          value={member.birthday ?? ''}
          onChange={(event) => onChange('birthday', event.target.value)}
          required
          error={showValidation && !member.birthday ? t('Birthdate is required.') : undefined}
        />
        <SelectField
          label={t('Sex')}
          value={member.sex ?? 'female'}
          onChange={(event) => onChange('sex', event.target.value as IndividualSex)}
        >
          <option value="female">{t('Female')}</option>
          <option value="male">{t('Male')}</option>
        </SelectField>
      </div>

      {/* The head has no relationship to themself, so the question is not asked of
          them. Whatever was picked before the head box was ticked is dropped at
          save time rather than cleared here — one place to strip it, and the
          answer survives an accidental tick-and-untick. */}
      {member.is_household_head ? null : (
        <SelectField
          label={t('Relationship to Household Head')}
          value={member.relationship_to_head ?? ''}
          onChange={(event) =>
            onChange('relationship_to_head', (event.target.value || null) as RelationshipToHead | null)
          }
        >
          {/* Blank first, and optional on purpose: a BHW who does not know how a
              boarder is related should leave it blank rather than pick the
              nearest wrong answer. Labels are titleCased from the stored value,
              the same way
              educational_attainment is displayed. */}
          <option value="">{t('(Not specified)')}</option>
          {RELATIONSHIPS_TO_HEAD.map((value) => (
            <option key={value} value={value}>
              {t(titleCase(value))}
            </option>
          ))}
        </SelectField>
      )}

      <div className="field-row">
        <FormField
          label={t('Occupation')}
          value={member.occupation ?? ''}
          onChange={(event) => onChange('occupation', event.target.value)}
          placeholder="(Optional)"
        />
        <SelectField
          label={t('Educational Attainment')}
          value={member.educational_attainment ?? ''}
          onChange={(event) => onChange('educational_attainment', event.target.value)}
        >
          {EDUCATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </SelectField>
      </div>

      <FormField
        label={t('PhilHealth Number')}
        value={member.philhealth_number ?? ''}
        onChange={(event) => onChange('philhealth_number', event.target.value)}
        placeholder="(Optional) e.g. 12-345678901-2"
        inputMode="numeric"
        hint={t('Dashes and spaces are fine — only the digits are saved.')}
      />

      <div className="choice-list">
        {children}
        <MemberChoice
          label={t('Out-of-school youth')}
          checked={member.is_out_of_school_youth ?? false}
          onChange={(next) => onChange('is_out_of_school_youth', next)}
        />
        <MemberChoice
          label={t('Pregnant, nursing, or using family planning')}
          checked={member.is_pregnant_nursing_fp ?? false}
          onChange={(next) => onChange('is_pregnant_nursing_fp', next)}
        />
      </div>
    </>
  );
}
