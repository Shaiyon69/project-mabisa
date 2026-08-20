import type { DuplicateMatch } from '../../lib/duplicates';
import { ageInYears } from '../../lib/utils';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import { TextAreaField } from '../common/FormField';
import { useBhwLanguage } from '../../app/BhwLanguageContext';

/** One member of the household being saved, and the records that look like them. */
export type FlaggedMember = {
  memberNumber: number;
  memberName: string;
  matches: DuplicateMatch[];
};

type DuplicateWarningModalProps = {
  open: boolean;
  flagged: FlaggedMember[];
  reason: string;
  saving: boolean;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onOverride: () => void;
};

/**
 * The duplicate warning, and the only thing standing between it and a save.
 *
 * It warns; it does not decide. MABISA performs no physical identity check, so
 * the person who can tell whether these are two people is the BHW in the room.
 * What the app owes in return is a record of the call they made — which is why
 * the override is disabled until a reason is typed.
 */
export function DuplicateWarningModal({
  open,
  flagged,
  reason,
  saving,
  onReasonChange,
  onCancel,
  onOverride,
}: DuplicateWarningModalProps) {
  const { t } = useBhwLanguage();
  const hasReason = reason.trim().length > 0;

  return (
    <Modal open={open} title={t('Someone here may already be registered')} onClose={onCancel}>
      <p className="duplicate-lede">
        {t('Check these records before saving. If this is a different person, say so and the app will keep your reason with the new record.')}
      </p>

      {flagged.map((member) => (
        <div key={member.memberNumber} className="duplicate-group">
          <h3>
            {t('Member')} {member.memberNumber}: {member.memberName}
          </h3>
          <ul className="compact-list">
            {member.matches.map((match) => (
              <li key={match.person.resident_id}>
                <span>
                  {match.person.last_name}, {match.person.first_name}
                  {match.person.middle_name ? ` ${match.person.middle_name.charAt(0)}.` : ''}
                </span>
                <small>
                  {ageInYears(match.person.birthday) ?? '—'} {t('years old')}
                  {match.person.household_number ? ` • ${match.person.household_number}` : ''}
                </small>
                <Badge
                  label={t(match.confidence === 'exact' ? 'Same name and birthdate' : 'Same name')}
                  tone={match.confidence === 'exact' ? 'danger' : 'warning'}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <TextAreaField
        label={t('Why is this a different person?')}
        value={reason}
        rows={3}
        onChange={(event) => onReasonChange(event.target.value)}
        hint={t('Saved with the record so an administrator can see who decided this and why.')}
      />

      <div className="modal-actions">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t('Go back and edit')}
        </Button>
        <Button variant="danger" onClick={onOverride} disabled={!hasReason || saving}>
          <Icon name="save" size={17} />
          {t(saving ? 'Saving Offline...' : 'Not the same person — save')}
        </Button>
      </div>
    </Modal>
  );
}
