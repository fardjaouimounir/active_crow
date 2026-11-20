import { assignmentProposal, today } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../shared/auth/hooks.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { FormField, SearchSelect } from '../../shared/ui/FormControls.jsx';
import { Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import {
  InputField,
  SelectField,
  actionStyle,
  primaryStyle,
} from '../organization/components/Fields.jsx';
import { assignmentPath, useAssignmentWrite, useCandidateOptions } from './api.js';

const weekdays = [1, 2, 3, 4, 5, 6, 7];

export function ProposeDialog({ campaign, onClose }) {
  const { t, i18n } = useTranslation('common');
  const { user } = useAuth();
  const [drafts, setDrafts] = useState([]);
  const [candidateLabel, setCandidateLabel] = useState('');
  const availableWilayas = campaign.wilayas.filter(
    ({ staff }) =>
      !['supervisor', 'regional_manager'].includes(user.role) ||
      staff.some(({ user: person, role }) => person.id === user.id && role === user.role),
  );
  const [wilayaId, setWilaya] = useState(availableWilayas[0]?.wilayaId ?? '');
  const {
    control,
    setValue,
    handleSubmit,
    unregister,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(assignmentProposal),
    defaultValues: {
      animateurId: '',
      pointOfSaleId: '',
      startDate: campaign.startDate > today() ? campaign.startDate : today(),
      endDate: campaign.endDate,
      workDays: weekdays,
    },
  });
  const data = useWatch({ control });
  const mutation = useAssignmentWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fields = { ...serverFields };
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const set = (name) => (value) => setValue(name, value, { shouldValidate: true });
  const area = availableWilayas.find((entry) => entry.wilayaId === Number(wilayaId));
  const points = campaign.pointsOfSale.filter((point) => point.wilayaId === Number(wilayaId));
  const useOptions = (q) =>
    useCandidateOptions(campaign.id, { wilayaId, from: data.startDate, to: data.endDate, q }, t);
  const request = (body, batch) =>
    mutation.mutate(
      {
        method: 'post',
        path: assignmentPath(campaign.id) + '/assignments' + (batch ? '/batch' : ''),
        body,
      },
      { onSuccess: onClose },
    );
  const rowErrors = mutation.error?.details?.items ?? [];
  const dayFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: 'short',
    timeZone: 'UTC',
  });
  return (
    <Modal title={t('assignments.propose')} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={handleSubmit((values) => request(values, false))}
        noValidate
      >
        <SelectField
          name="wilaya"
          value={wilayaId}
          options={availableWilayas.map((entry) => ({
            value: entry.wilayaId,
            label: i18n.resolvedLanguage === 'ar' ? entry.wilaya.nameAr : entry.wilaya.nameEn,
          }))}
          onChange={(value) => {
            setWilaya(value);
            setValue('pointOfSaleId', '');
            unregister('supervisorId');
            setValue('animateurId', '');
          }}
        />
        <SelectField
          name="point"
          fields={{ point: fields.pointOfSaleId }}
          value={data.pointOfSaleId}
          options={points.map(({ id, name }) => ({ value: id, label: name }))}
          onChange={set('pointOfSaleId')}
        />
        {user.role !== 'supervisor' && (
          <SelectField
            name="supervisor"
            fields={{ supervisor: fields.supervisorId }}
            value={data.supervisorId}
            options={(area?.staff ?? [])
              .filter(({ role }) => role === 'supervisor')
              .map(({ user }) => ({ value: user.id, label: user.fullName }))}
            onChange={(value) => (value ? set('supervisorId')(value) : unregister('supervisorId'))}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {['startDate', 'endDate'].map((name) => (
            <InputField
              key={name}
              name={name}
              type="date"
              fields={fields}
              value={data[name]}
              onChange={set(name)}
            />
          ))}
        </div>
        <FormField label={t('roles.animateur')} error={fields.animateurId}>
          {(props) => (
            <SearchSelect
              {...props}
              useOptions={useOptions}
              value={data.animateurId}
              onChange={(id, label) => {
                set('animateurId')(id);
                setCandidateLabel(label);
              }}
            />
          )}
        </FormField>
        <fieldset className="flex flex-wrap gap-2 text-sm">
          <legend className="mb-1 font-medium">{t('assignments.workDays')}</legend>
          {weekdays.map((day) => (
            <label key={day} className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={data.workDays?.includes(day) ?? false}
                onChange={(event) =>
                  set('workDays')(
                    event.target.checked
                      ? [...(data.workDays ?? []), day].sort()
                      : data.workDays.filter((value) => value !== day),
                  )
                }
              />
              {dayFormat.format(new Date(Date.UTC(2026, 0, 4 + day)))}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          {['shiftStart', 'shiftEnd'].map((name) => (
            <InputField
              key={name}
              name={name}
              type="time"
              fields={fields}
              value={data[name]}
              onChange={(value) => (value ? set(name)(value) : unregister(name))}
            />
          ))}
        </div>
        <Toast error message={message} />
        <div className="flex flex-wrap gap-2">
          <button className={primaryStyle} disabled={mutation.isPending || drafts.length > 0}>
            {t('assignments.propose')}
          </button>
          <button
            type="button"
            className={actionStyle}
            disabled={drafts.length >= 100 || mutation.isPending}
            onClick={handleSubmit((value) => {
              setDrafts([...drafts, { proposal: value, label: candidateLabel }]);
              setValue('animateurId', '');
            })}
          >
            {t('assignments.addProposal')}
          </button>
        </div>
        {drafts.length > 0 && (
          <div className="grid gap-2">
            <ol className="space-y-2">
              {drafts.map(({ proposal: row, label }, index) => (
                <li key={index} className="rounded border p-2 text-sm">
                  <span>
                    {label} ·{' '}
                    {campaign.pointsOfSale.find(({ id }) => id === row.pointOfSaleId)?.name} ·{' '}
                    {row.startDate} – {row.endDate}
                  </span>
                  <button
                    type="button"
                    className="ms-2 underline"
                    onClick={() => {
                      mutation.reset();
                      setDrafts(drafts.filter((_, i) => i !== index));
                    }}
                  >
                    {t('admin.delete')}
                  </button>
                  {rowErrors
                    .filter((issue) => issue.index === index)
                    .map(({ code }) => (
                      <Toast key={code} error message={t('errors.codes.' + code)} />
                    ))}
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={primaryStyle}
              disabled={mutation.isPending}
              onClick={() =>
                request(
                  drafts.map(({ proposal }) => proposal),
                  true,
                )
              }
            >
              {t('assignments.submitBatch', { count: drafts.length })}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
