import type { HealthAssessment, SupplyDisbursement } from '../../types/database';
import { formatDate, titleCase } from '../../lib/utils';
import { Card } from '../common/Card';
import { EmptyState } from '../common/StateMessage';

type ReportCardsProps = {
  assessments: HealthAssessment[];
  disbursements: SupplyDisbursement[];
};

export function ReportCards({ assessments, disbursements }: ReportCardsProps) {
  const latestAssessments = assessments.slice(0, 5);
  const latestDisbursements = disbursements.slice(0, 5);

  return (
    <div className="activity-grid">
      <Card className="activity-card" as="article">
        <h3>Nutrition Status Trends</h3>
        {latestAssessments.length ? (
          <ul className="compact-list">
            {latestAssessments.map((assessment) => (
              <li key={assessment.assessment_id}>
                <span>{titleCase(assessment.nutrition_status)}</span>
                <small>
                  {assessment.bmi.toFixed(2)} BMI • {formatDate(assessment.assessment_date)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No assessment data" text="Health assessment summaries will appear here." />
        )}
      </Card>
      <Card className="activity-card" as="article">
        <h3>Supply Release Activity</h3>
        {latestDisbursements.length ? (
          <ul className="compact-list">
            {latestDisbursements.map((disbursement) => (
              <li key={disbursement.log_id}>
                <span>{disbursement.quantity} item(s) released</span>
                <small>{formatDate(disbursement.disbursement_date)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No disbursement data" text="Supply allocation summaries will appear here." />
        )}
      </Card>
    </div>
  );
}
