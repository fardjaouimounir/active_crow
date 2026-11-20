import { useTranslation } from 'react-i18next';
import { Modal } from '../../../shared/ui/Dialogs.jsx';
import { CopyField } from '../../../shared/ui/FormControls.jsx';
import { primaryStyle } from './Fields.jsx';

export function PasswordDialog({ value, onClose }) {
  const { t } = useTranslation('common');
  return (
    <Modal title={t('admin.temporaryPassword')} onClose={onClose}>
      <div className="grid gap-4">
        <p className="text-sm">{t('admin.passwordWarning')}</p>
        <CopyField value={value} />
        <div className="text-end">
          <button type="button" className={primaryStyle} onClick={onClose}>
            {t('admin.done')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
