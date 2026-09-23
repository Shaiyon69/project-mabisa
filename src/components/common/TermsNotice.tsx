import { Modal } from './Modal';

/**
 * The version a sign-in agrees to, recorded in `terms_acceptances`. Change it
 * with any change to the text below that alters what a user agrees to, so the
 * record says which wording each person accepted.
 */
export const TERMS_VERSION = '2026-09-23';

/**
 * Terms of Use and Privacy Notice under the Data Privacy Act of 2012 (Republic
 * Act No. 10173), its Implementing Rules and Regulations, and the issuances of
 * the National Privacy Commission.
 *
 * Bundled rather than fetched: it is shown on the sign-in screen, which a BHW may
 * open with no connection.
 */
export function TermsNotice() {
  return (
    <div className="terms-body">
      <p className="muted">Version {TERMS_VERSION}</p>

      <h3>1. About this notice</h3>
      <p>
        The Barangay Residents Health Profiling and Medical Supply Allocation Monitoring System (BRHP-MSAM) holds
        personal and health information about residents of the barangays it serves. These terms set out how that
        information is handled under the Data Privacy Act of 2012 (Republic Act No. 10173), and what every person
        given an account agrees to before signing in.
      </p>

      <h3>2. Who is responsible</h3>
      <p>
        The Local Government Unit, through its Rural Health Unit (RHU), is the personal information controller for
        the records in this system. Barangay Health Workers and barangay and RHU staff who hold accounts process
        those records on the LGU&apos;s behalf, only for the duties assigned to them.
      </p>

      <h3>3. What information the system holds</h3>
      <p>About residents:</p>
      <ul>
        <li>name, sex, date of birth, household and purok, and relationship to the household head;</li>
        <li>occupation, educational attainment, and whether they are an out-of-school youth;</li>
        <li>PhilHealth number, where recorded;</li>
        <li>
          health check results, including vital signs, height, weight and nutrition screening, illnesses and
          conditions, pregnancy, nursing and family planning status, and immunizations; and
        </li>
        <li>medical supplies released to them.</li>
      </ul>
      <p>
        Health information, age, education and government-issued identifiers such as the PhilHealth number are
        sensitive personal information under Section 3(l) of the Act and receive the highest level of protection.
      </p>
      <p>
        About account holders: name, email address, role, barangay or purok assignment, and a record of sign-ins
        and of the changes each account makes.
      </p>

      <h3>4. Why it is processed</h3>
      <p>
        The information is processed to profile the health of barangay residents, plan and deliver health services,
        and monitor how medical supplies are allocated and released. These are public health functions of the LGU.
        Processing rests on Sections 12 and 13 of the Act, as necessary to carry out those functions under law and
        to protect the life and health of residents. It is not used for any other purpose, sold, or shared with
        anyone outside the health offices except where the law requires it.
      </p>

      <h3>5. What you agree to as an account holder</h3>
      <ul>
        <li>Use the system and its records only for your official duties, and only within your assigned area.</li>
        <li>
          Keep your password and device PIN to yourself. Do not let anyone else sign in as you, and do not sign in as
          anyone else.
        </li>
        <li>
          Do not copy, photograph, print, export or send resident records outside the system, except through the
          system&apos;s own reports, for an official purpose.
        </li>
        <li>Keep the phone or computer you use locked when not in use, and sign out of shared computers.</li>
        <li>
          Report a lost or stolen device, a password you think someone else knows, or any record seen by someone who
          should not have seen it, to your health office right away. The LGU has to notify the National Privacy
          Commission and the affected residents within 72 hours of learning of certain breaches.
        </li>
        <li>
          Refer any resident who asks to see, correct or remove their information to the health office. Do not
          change or remove records informally.
        </li>
        <li>Keep what you learn from these records confidential, during your assignment and after it ends.</li>
      </ul>

      <h3>6. How the information is protected</h3>
      <p>
        Records on BHW phones are stored encrypted. Every account sees only what its role and assignment allow, and
        this is enforced by the central database, not only by the app. Data travels over encrypted connections.
        Sign-in is protected by a security check and by limits on repeated wrong passwords, and changes are logged.
      </p>

      <h3>7. How long it is kept</h3>
      <p>
        Records are kept for as long as they are needed for the health programs they serve and as required by
        government records retention rules, then disposed of securely.
      </p>

      <h3>8. Rights of residents</h3>
      <p>
        Under Sections 16 to 18 of the Act, residents have the right to be informed, to object, to access, to
        rectification, to erasure or blocking, to data portability, and to damages, and may file a complaint with the
        National Privacy Commission. Requests go to the Data Protection Officer of the RHU.
      </p>

      <h3>9. Monitoring and consequences</h3>
      <p>
        Activity in the system is logged and may be reviewed. Misuse can lead to the account being disabled and to
        administrative action. Unauthorized processing, access due to negligence, improper disposal, processing for
        unauthorized purposes, unauthorized access, concealment of a breach, malicious disclosure and unauthorized
        disclosure are offenses under Sections 25 to 32 of the Act, punishable by imprisonment and fines.
      </p>

      <h3>10. Changes to these terms</h3>
      <p>
        When these terms change, you will be asked to agree to the new version the next time you sign in.
      </p>

      <h3>11. Contact</h3>
      <p>
        Questions about these terms or about personal information in this system go to the Data Protection Officer of
        your Rural Health Unit. You may also contact the National Privacy Commission at privacy.gov.ph.
      </p>
    </div>
  );
}

type TermsDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function TermsDialog({ open, onClose }: TermsDialogProps) {
  return (
    <Modal open={open} title="Terms and Conditions" onClose={onClose} className="terms-dialog">
      <TermsNotice />
    </Modal>
  );
}
