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
const number = (value) => (value == null || value === '' ? null : Number(value));

function PointForm({ point, canManage }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [values, setValues] = useState(point ?? {});
  const [deleted, setDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (fields) => setValues((previous) => ({ ...previous, ...fields }));
  const mutation = usePointOfSaleWrite();
  const { fields, message } = useApiError(mutation.error);
  const path = '/points-of-sale' + (point ? '/' + point.id : '');
  return (
    <>
      {saved && <Toast message={t('admin.saved')} />}
      <form
        className="grid max-w-2xl gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canManage) return;
          const body = Object.fromEntries(fieldNames.map((key) => [key, values[key] || null]));
          Object.assign(body, {
            wilayaId: Number(values.wilayaId),
            communeId: number(values.communeId),
            latitude: number(values.latitude),
            longitude: number(values.longitude),
          });
          if (point) body.version = values.version;
          mutation.mutate(
            { method: point ? 'patch' : 'post', path, body },
            {
              onSuccess: (result) => {
                if (!point) navigate('/app/points-of-sale/' + result.id, { replace: true });
                else {
                  setValues(result);
                  setSaved(true);
                }
              },
            },
          );
        }}
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
                onChange={(value) => set({ [name]: value })}
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
