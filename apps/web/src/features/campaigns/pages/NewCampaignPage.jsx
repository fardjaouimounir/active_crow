import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { PageHeader, Toast } from '../../../shared/ui/PageParts.jsx';
import { actionStyle } from '../../organization/components/Fields.jsx';
import { CampaignForm } from '../components/CampaignForm.jsx';

export function NewCampaignPage() {
  const { t } = useTranslation('common');
  const canCreate = useCan('campaign.manage');
  const navigate = useNavigate();
  if (!canCreate) return <Toast error message={t('errors.codes.FORBIDDEN')} />;
  return (
    <>
      <PageHeader title={t('campaigns.new')}>
        <Link className={actionStyle} to="/app/campaigns">
          {t('admin.back')}
        </Link>
      </PageHeader>
      <div className="max-w-xl rounded-xl border border-line bg-surface p-5">
        <CampaignForm
          onSuccess={(campaign) => navigate('/app/campaigns/' + campaign.id, { replace: true })}
        />
      </div>
    </>
  );
}
