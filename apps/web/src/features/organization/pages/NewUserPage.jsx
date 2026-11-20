import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { PageHeader, Toast } from '../../../shared/ui/PageParts.jsx';
import { actionStyle } from '../components/Fields.jsx';
import { PasswordDialog } from '../components/PasswordDialog.jsx';
import { UserForm } from '../components/UserForm.jsx';

export function NewUserPage() {
  const { t } = useTranslation('common');
  const canCreate = useCan('org.user.manage');
  const navigate = useNavigate();
  const [created, setCreated] = useState(null);
  if (!canCreate) return <Toast error message={t('errors.codes.FORBIDDEN')} />;
  return (
    <>
      <PageHeader title={t('admin.newUser')}>
        <Link className={actionStyle} to="/app/users">
          {t('admin.back')}
        </Link>
      </PageHeader>
      {created ? (
        <PasswordDialog
          value={created.temporaryPassword}
          onClose={() => {
            const { id } = created.user;
            setCreated(null);
            navigate('/app/users/' + id, { replace: true });
          }}
        />
      ) : (
        <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-5">
          <UserForm onSuccess={setCreated} />
        </div>
      )}
    </>
  );
}
