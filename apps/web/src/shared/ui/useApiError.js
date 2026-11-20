import { VALIDATION_FAILED } from '@fieldflow/shared';
import { useTranslation } from 'react-i18next';

const fieldByCode = {
  EMAIL_TAKEN: 'email',
  INVALID_MANAGER_ROLE: 'managerId',
  MANAGER_CYCLE: 'newManagerId',
  COMMUNE_NOT_IN_WILAYA: 'communeId',
  TRANSFER_DATE_INVALID: 'effectiveDate',
  POS_CODE_TAKEN: 'code',
  WILAYA_ALREADY_IN_REGION: 'wilayaIds',
  ROLE_NOT_CREATABLE: 'role',
};

/** Translates the API error and indexes validation errors by form field. */
export function useApiError(error) {
  const { t } = useTranslation('common');
  if (!error) return { message: '', fields: {} };
  const message = t('errors.codes.' + error.code, {
    defaultValue: t('errors.codes.INTERNAL_ERROR'),
  });
  const fields = {};
  if (error.code === VALIDATION_FAILED && Array.isArray(error.details)) {
    for (const issue of error.details) {
      if (issue.path?.startsWith('body.')) {
        fields[issue.path.slice(5)] = t('admin.invalidField');
      }
    }
  }
  const field = fieldByCode[error.code];
  if (field) fields[field] = message;
  return { message, fields };
}
