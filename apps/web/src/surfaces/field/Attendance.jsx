import { fieldCheckpointBody } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  Availability,
  ErrorMessage,
  PendingSubmission,
  PhotoPicker,
  QueryState,
  card,
  control,
  fieldTime,
  primary,
  secondary,
  useField,
} from './ui.jsx';
import { useFieldSubmit } from './useFieldSubmit.js';

function CheckpointForm({ checkpoints, field, write, initial }) {
  const { t, i18n } = useTranslation('field');
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [locating, setLocating] = useState(false);
  const {
    control: formControl,
    register,
    handleSubmit,
    setValue,
    reset,
  } = useForm({
    resolver: zodResolver(fieldCheckpointBody),
    defaultValues: initial,
  });
  const choice = useWatch({ control: formControl, name: 'checkpoint' });
  const accuracy = useWatch({ control: formControl, name: 'gpsAccuracyM' });
  const checkpoint = checkpoints.find(({ code }) => code === choice);
  function locate() {
    setLocationError(false);
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setValue('latitude', coords.latitude);
        setValue('longitude', coords.longitude);
        setValue('gpsAccuracyM', Math.min(10000, Math.round(coords.accuracy)));
        setLocating(false);
      },
      () => {
        setLocationError(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  return (
    <form
      className={card}
      onSubmit={handleSubmit((body) => {
        if (!checkpoint || (checkpoint.photo && !file) || (checkpoint.gps && accuracy == null))
          return;
        void write.submit({
          path: `/assignments/${field.assignmentId}/attendance`,
          body,
          file,
          fileField: 'photo',
          multipart: true,
        });
      })}
    >
      <fieldset className="grid gap-3" disabled={write.busy || Boolean(write.pending)}>
        <label className="grid gap-1">
          {t('checkpoint')}
          <select
            className={control}
            {...register('checkpoint', {
              onChange: (event) => reset({ checkpoint: event.target.value }),
            })}
          >
            {checkpoints.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label[i18n.resolvedLanguage] ?? item.label.en}
              </option>
            ))}
          </select>
        </label>
        <PhotoPicker
          file={file}
          onChange={setFile}
          required={checkpoint?.photo}
          onProcessing={setProcessing}
        />
        {checkpoint?.gps && (
          <div className="grid gap-2">
            <button type="button" className={secondary} disabled={locating} onClick={locate}>
              {t(locating ? 'locating' : 'getLocation')}
            </button>
            {accuracy != null && <p>{t('accuracy', { accuracy })}</p>}
            {locationError && <ErrorMessage code="LOCATION_PERMISSION" />}
          </div>
        )}
        <button
          className={primary}
          disabled={
            processing ||
            !checkpoint ||
            (checkpoint.photo && !file) ||
            (checkpoint.gps && accuracy == null)
          }
        >
          {t(write.busy ? 'sending' : 'recordCheckpoint')}
        </button>
      </fieldset>
    </form>
  );
}

export function Attendance() {
  const { t, i18n } = useTranslation('field');
  const [params] = useSearchParams();
  const { sale, attendance, field, current } = useField();
  const [result, setResult] = useState(null);
  const write = useFieldSubmit('attendance', setResult);
  const checkpoints = current?.checkpoints.filter((item) => item.isOpen && !item.record) ?? [];
  const initial = write.pending?.body ?? {
    checkpoint: checkpoints.some((item) => item.code === params.get('checkpoint'))
      ? params.get('checkpoint')
      : (checkpoints[0]?.code ?? ''),
  };
  return (
    <>
      <h1 className="text-2xl font-bold">{t('attendance')}</h1>
      <PendingSubmission write={write}>
        {write.pending && (
          <p>
            {t('checkpoint')} · {write.pending.body.checkpoint}
          </p>
        )}
      </PendingSubmission>
      {result ? (
        <section className={card} aria-live="polite">
          <h2 className="text-xl font-bold">{t('attendanceRecorded')}</h2>
          <p>
            {t('recordedTime', { time: fieldTime(result.recordedAt, i18n.language) })} ·{' '}
            {t('pending')}
          </p>
          {result.isLate && <strong>{t('late')}</strong>}
          {result.flags
            ?.filter((flag) => flag !== 'late')
            .map((flag) => (
              <p key={flag}>
                {t('flags.' + flag, { distance: ((result.distanceM ?? 0) / 1000).toFixed(1) })}
              </p>
            ))}
          <button className={secondary} onClick={() => setResult(null)}>
            {t('continue')}
          </button>
        </section>
      ) : !field || field.closedReason ? (
        <Availability query={sale} field={field} next={sale.data?.data.nextAssignmentDate} />
      ) : (
        <>
          <QueryState query={attendance} />
          {checkpoints.length ? (
            <CheckpointForm
              field={field}
              checkpoints={checkpoints}
              initial={initial}
              key={field.assignmentId + ':' + checkpoints.map(({ code }) => code).join(',')}
              write={write}
            />
          ) : (
            attendance.isSuccess && <p className={card}>{t('noCheckpoints')}</p>
          )}
        </>
      )}
    </>
  );
}
