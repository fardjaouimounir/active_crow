import { createPointFormSchema, updatePointFormSchema } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog } from '../../../shared/ui/Dialogs.jsx';
import { PageHeader, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import {
  InputField,
  LocationFields,
  actionStyle,
  primaryStyle,
} from '../../organization/components/Fields.jsx';
import { usePointOfSale, usePointOfSaleWrite } from '../api.js';

const fieldNames = [
  'name',
  'code',
  'type',
  'address',
  'latitude',
  'longitude',
  'contactName',
  'contactPhone',
];

const requiredFields = ['name', 'code', 'type'];
const pointValues = (point) => ({
  ...Object.fromEntries(
    fieldNames.map((key) => [key, point?.[key] ?? (requiredFields.includes(key) ? '' : null)]),
  ),
  wilayaId: point?.wilayaId ?? null,
  communeId: point?.communeId ?? null,
  ...(point ? { version: point.version } : {}),
});

function PointForm({ point, canManage }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const {
    control,
    setValue,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(point ? updatePointFormSchema : createPointFormSchema),
    defaultValues: pointValues(point),
  });
  const values = useWatch({ control });
  const [deleted, setDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch) => {
    for (const [key, value] of Object.entries(patch))
      setValue(key, value, { shouldValidate: true });
  };
  const mutation = usePointOfSaleWrite();
  const { fields: serverFields, message } = useApiError(mutation.error);
  const fields = { ...serverFields };
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const path = '/points-of-sale' + (point ? '/' + point.id : '');
  return (
    <>
      {saved && <Toast message={t('admin.saved')} />}
      <form
        className="grid max-w-2xl gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2"
        noValidate
        onSubmit={handleSubmit((body) => {
          if (!canManage) return;
          mutation.mutate(
            { method: point ? 'patch' : 'post', path, body },
            {
              onSuccess: (result) => {
                if (!point) navigate('/app/points-of-sale/' + result.id, { replace: true });
                else {
                  reset(pointValues(result));
                  setSaved(true);
                }
              },
            },
          );
        })}
      >
        <fieldset className="contents" disabled={!canManage || mutation.isPending}>
          {fieldNames.map((name) => {
            const coordinate = ['latitude', 'longitude'].includes(name);
            return (
              <InputField
                key={name}
                name={name}
                fields={fields}
                value={values[name]}
                onChange={(value) =>
                  set({
                    [name]: coordinate || requiredFields.includes(name) ? value : value || null,
                  })
                }
                type={coordinate ? 'number' : name === 'contactPhone' ? 'tel' : 'text'}
                step={coordinate ? 'any' : undefined}
                min={coordinate ? (name === 'latitude' ? -90 : -180) : undefined}
                max={coordinate ? (name === 'latitude' ? 90 : 180) : undefined}
                required={['name', 'code', 'type'].includes(name)}
              />
            );
          })}
          <LocationFields values={values} set={set} fields={fields} required />
        </fieldset>
        {!deleted && (
          <div className="col-span-full">
            <Toast error message={message} />
          </div>
        )}
        {canManage && (
          <div className="col-span-full flex flex-wrap gap-2">
            <button className={primaryStyle} disabled={mutation.isPending}>
              {t('admin.save')}
            </button>
            {point && (
              <button
                type="button"
                className={actionStyle}
                onClick={() => {
                  mutation.reset();
                  setDelete(true);
                }}
              >
                {t('admin.delete')}
              </button>
            )}
          </div>
        )}
      </form>
      {deleted && (
        <ConfirmDialog
          title={t('admin.delete')}
          message={t('admin.confirmChange')}
          pending={mutation.isPending}
          onClose={() => {
            setDelete(false);
            mutation.reset();
          }}
          onConfirm={() =>
            mutation.mutate(
              { method: 'delete', path },
              { onSuccess: () => navigate('/app/points-of-sale', { replace: true }) },
            )
          }
        >
          <Toast error message={message} />
        </ConfirmDialog>
      )}
    </>
  );
}

export function PointPage() {
  const { id } = useParams();
  const location = useLocation();
  const { t } = useTranslation('common');
  const canManage = useCan('org.structure.manage');
  const query = usePointOfSale(id);
  const { message } = useApiError(query.error);
  const point = query.data?.data;
  if (!id && !canManage) return <Toast error message={t('errors.codes.FORBIDDEN')} />;
  return (
    <>
      <PageHeader title={id ? (point?.name ?? t('admin.points')) : t('admin.newPoint')}>
        <Link
          to={{ pathname: '/app/points-of-sale', search: location.state?.listSearch ?? '' }}
          className={actionStyle}
        >
          {t('admin.back')}
        </Link>
      </PageHeader>
      {id && query.isPending && <p role="status">{t('admin.loading')}</p>}
      {message && <Toast error message={message} />}
      {(!id || point) && <PointForm key={id ?? 'new'} point={point} canManage={canManage} />}
    </>
  );
}
