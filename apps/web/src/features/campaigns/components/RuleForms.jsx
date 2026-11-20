import { CUSTOMER_FIELD_MODES, DAILY_REPORT_QUESTION_TYPES, RULE_SCHEMAS } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { get, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, Select, TextInput } from '../../../shared/ui/FormControls.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { actionStyle, primaryStyle } from '../../organization/components/Fields.jsx';
import { useCampaignWrite } from '../api.js';

/** Form values of a rule type that has no saved config yet. */
export const RULE_DEFAULTS = {
  attendance: {
    checkpoints: [
      {
        code: 'morning',
        label: { ar: 'الحضور الصباحي', en: 'Morning check-in' },
        window: ['08:30', '09:30'],
        photo: true,
        gps: true,
      },
    ],
    lateToleranceMinutes: 15,
    autoVerifyAfterHours: null,
    maxDistanceMeters: 300,
  },
  uniform: { required: false, descriptionAr: '', descriptionEn: '' },
  sales_target: { dailyUnitsPerAnimateur: 30, perProduct: [] },
  sampling_target: { dailySamplesPerAnimateur: 100, stockItemId: '' },
  customer_fields: { fullName: 'required', phone: 'optional', consentRequired: true },
  daily_report: { required: true, questions: [] },
};

const EMPTY_CHECKPOINT = {
  code: '',
  label: { ar: '', en: '' },
  window: ['', ''],
  photo: true,
  gps: false,
};
const EMPTY_QUESTION = { code: '', label: { ar: '', en: '' }, type: 'text', required: false };

/** Stored config → form values (uniform keeps its two description languages as separate inputs). */
function toValues(type, config) {
  if (!config) return RULE_DEFAULTS[type];
  if (type === 'uniform') {
    return {
      required: config.required,
      descriptionAr: config.description?.ar ?? '',
      descriptionEn: config.description?.en ?? '',
    };
  }
  return config;
}

/** Form values → the config the API expects. */
function toConfig(type, values) {
  if (type !== 'uniform') return values;
  const { descriptionAr, descriptionEn, required } = values;
  return {
    required,
    description: descriptionAr || descriptionEn ? { ar: descriptionAr, en: descriptionEn } : null,
  };
}

const DESCRIPTION_INPUTS = { descriptionAr: 'description.ar', descriptionEn: 'description.en' };

const nullableNumber = {
  setValueAs: (value) => (value === '' || value == null ? null : Number(value)),
};
const integer = { valueAsNumber: true };

function Check({ label, register, name }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" {...register(name)} />
      {label}
    </label>
  );
}

function Text({ ctx, name, label, type = 'text', ...props }) {
  return (
    <FormField label={label} error={ctx.fieldError(name)}>
      {(input) => <TextInput {...input} type={type} {...props} {...ctx.register(name)} />}
    </FormField>
  );
}

function Num({ ctx, name, label, nullable = false, ...props }) {
  return (
    <FormField label={label} error={ctx.fieldError(name)}>
      {(input) => (
        <TextInput
          {...input}
          type="number"
          dir="ltr"
          {...props}
          {...ctx.register(name, nullable ? nullableNumber : integer)}
        />
      )}
    </FormField>
  );
}

function Choice({ ctx, name, label, options }) {
  const { t } = useTranslation('common');
  return (
    <FormField label={label} error={ctx.fieldError(name)}>
      {(input) => (
        <Select {...input} {...ctx.register(name)}>
          <option value="">{t('admin.choose')}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

function Rows({ ctx, name, empty, max, min = 0, title, addLabel, children }) {
  const { t } = useTranslation('common');
  const { fields, append, remove } = useFieldArray({ control: ctx.control, name });
  return (
    <div className="grid gap-3">
      {fields.map((item, index) => (
        <fieldset key={item.id} className="grid gap-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">{title(index + 1)}</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {children(`${name}.${index}`)}
          </div>
          <div>
            <button
              type="button"
              className={actionStyle}
              disabled={fields.length <= min}
              onClick={() => remove(index)}
            >
              {t('rules.removeRow')}
            </button>
          </div>
        </fieldset>
      ))}
      <div>
        <button
          type="button"
          className={actionStyle}
          disabled={fields.length >= max}
          onClick={() => append(structuredClone(empty))}
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function AttendanceFields({ ctx }) {
  const { t } = useTranslation('common');
  return (
    <>
      <Rows
        ctx={ctx}
        name="checkpoints"
        empty={EMPTY_CHECKPOINT}
        min={1}
        max={4}
        title={(n) => t('rules.fields.checkpoint', { n })}
        addLabel={t('rules.fields.addCheckpoint')}
      >
        {(path) => (
          <>
            <Text ctx={ctx} name={`${path}.code`} label={t('rules.fields.code')} dir="ltr" />
            <Text ctx={ctx} name={`${path}.label.en`} label={t('rules.fields.labelEn')} dir="ltr" />
            <Text ctx={ctx} name={`${path}.label.ar`} label={t('rules.fields.labelAr')} dir="rtl" />
            <div className="grid grid-cols-2 gap-2">
              <Text
                ctx={ctx}
                name={`${path}.window.0`}
                type="time"
                label={t('rules.fields.windowStart')}
              />
              <Text
                ctx={ctx}
                name={`${path}.window.1`}
                type="time"
                label={t('rules.fields.windowEnd')}
              />
            </div>
            <Check label={t('rules.fields.photo')} register={ctx.register} name={`${path}.photo`} />
            <Check label={t('rules.fields.gps')} register={ctx.register} name={`${path}.gps`} />
          </>
        )}
      </Rows>
      <div className="grid gap-3 sm:grid-cols-3">
        <Num
          ctx={ctx}
          name="lateToleranceMinutes"
          label={t('rules.fields.lateToleranceMinutes')}
          min={0}
          max={120}
        />
        <Num
          ctx={ctx}
          name="autoVerifyAfterHours"
          label={t('rules.fields.autoVerifyAfterHours')}
          nullable
          min={1}
          max={72}
        />
        <Num
          ctx={ctx}
          name="maxDistanceMeters"
          label={t('rules.fields.maxDistanceMeters')}
          nullable
          min={50}
          max={5000}
        />
      </div>
    </>
  );
}

function UniformFields({ ctx }) {
  const { t } = useTranslation('common');
  return (
    <div className="grid gap-3">
      <Check label={t('rules.fields.uniformRequired')} register={ctx.register} name="required" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Text ctx={ctx} name="descriptionEn" label={t('rules.fields.descriptionEn')} dir="ltr" />
        <Text ctx={ctx} name="descriptionAr" label={t('rules.fields.descriptionAr')} dir="rtl" />
      </div>
    </div>
  );
}

function SalesTargetFields({ ctx, products }) {
  const { t } = useTranslation('common');
  return (
    <div className="grid gap-3">
      <Num
        ctx={ctx}
        name="dailyUnitsPerAnimateur"
        label={t('rules.fields.dailyUnitsPerAnimateur')}
        min={1}
        max={10000}
      />
      <Rows
        ctx={ctx}
        name="perProduct"
        empty={{ productId: '', dailyUnits: 10 }}
        max={200}
        title={(n) => t('rules.fields.perProductRow', { n })}
        addLabel={t('rules.fields.addProduct')}
      >
        {(path) => (
          <>
            <Choice
              ctx={ctx}
              name={`${path}.productId`}
              label={t('rules.fields.product')}
              options={products}
            />
            <Num
              ctx={ctx}
              name={`${path}.dailyUnits`}
              label={t('rules.fields.dailyUnits')}
              min={1}
              max={10000}
            />
          </>
        )}
      </Rows>
    </div>
  );
}

function SamplingTargetFields({ ctx, samples }) {
  const { t } = useTranslation('common');
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Num
        ctx={ctx}
        name="dailySamplesPerAnimateur"
        label={t('rules.fields.dailySamplesPerAnimateur')}
        min={1}
        max={10000}
      />
      <Choice ctx={ctx} name="stockItemId" label={t('rules.fields.sampleItem')} options={samples} />
    </div>
  );
}

function CustomerFieldsFields({ ctx }) {
  const { t } = useTranslation('common');
  const modes = CUSTOMER_FIELD_MODES.map((value) => ({ value, label: t('rules.modes.' + value) }));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Choice ctx={ctx} name="fullName" label={t('rules.fields.fullName')} options={modes} />
      <Choice ctx={ctx} name="phone" label={t('rules.fields.phone')} options={modes} />
      <Check
        label={t('rules.fields.consentRequired')}
        register={ctx.register}
        name="consentRequired"
      />
    </div>
  );
}

function DailyReportFields({ ctx }) {
  const { t } = useTranslation('common');
  const types = DAILY_REPORT_QUESTION_TYPES.map((value) => ({
    value,
    label: t('rules.questionTypes.' + value),
  }));
  return (
    <div className="grid gap-3">
      <Check label={t('rules.fields.reportRequired')} register={ctx.register} name="required" />
      <Rows
        ctx={ctx}
        name="questions"
        empty={EMPTY_QUESTION}
        max={10}
        title={(n) => t('rules.fields.question', { n })}
        addLabel={t('rules.fields.addQuestion')}
      >
        {(path) => (
          <>
            <Text ctx={ctx} name={`${path}.code`} label={t('rules.fields.code')} dir="ltr" />
            <Text ctx={ctx} name={`${path}.label.en`} label={t('rules.fields.labelEn')} dir="ltr" />
            <Text ctx={ctx} name={`${path}.label.ar`} label={t('rules.fields.labelAr')} dir="rtl" />
            <Choice
              ctx={ctx}
              name={`${path}.type`}
              label={t('rules.fields.questionType')}
              options={types}
            />
            <Check
              label={t('rules.fields.questionRequired')}
              register={ctx.register}
              name={`${path}.required`}
            />
          </>
        )}
      </Rows>
    </div>
  );
}

/**
 * The form of one rule type of a draft rule set: shared Zod schema as resolver, server errors
 * mapped to the exact field through `details.path`. Read-only when the set is approved.
 */
export function RuleForm({
  type,
  config,
  campaignId,
  ruleSetId,
  products,
  samples,
  readOnly,
  onSaved,
  onCancel,
}) {
  const { t } = useTranslation('common');
  const form = useForm({
    resolver: (values, context, options) =>
      zodResolver(RULE_SCHEMAS[type])(toConfig(type, values), context, options),
    defaultValues: toValues(type, config),
  });
  const mutation = useCampaignWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fieldError = (name) => {
    // The uniform form has two flat inputs for the config's nested `description.{ar,en}`.
    const path = DESCRIPTION_INPUTS[name] ?? name;
    const errors = form.formState.errors;
    if (get(errors, path) || (DESCRIPTION_INPUTS[name] && get(errors, 'description'))) {
      return t('admin.invalidField');
    }
    return serverFields[path];
  };
  const ctx = { control: form.control, register: form.register, fieldError };
  const onSubmit = form.handleSubmit((values) =>
    mutation.mutate(
      {
        method: 'put',
        path: `/campaigns/${campaignId}/rule-sets/${ruleSetId}/rules/${type}`,
        body: toConfig(type, values),
      },
      { onSuccess: () => onSaved?.() },
    ),
  );
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="grid gap-4"
      aria-label={t('rules.types.' + type)}
    >
      <fieldset disabled={readOnly || mutation.isPending} className="grid gap-4">
        {type === 'attendance' && <AttendanceFields ctx={ctx} />}
        {type === 'uniform' && <UniformFields ctx={ctx} />}
        {type === 'sales_target' && <SalesTargetFields ctx={ctx} products={products} />}
        {type === 'sampling_target' && <SamplingTargetFields ctx={ctx} samples={samples} />}
        {type === 'customer_fields' && <CustomerFieldsFields ctx={ctx} />}
        {type === 'daily_report' && <DailyReportFields ctx={ctx} />}
      </fieldset>
      <Toast error message={message} />
      {!readOnly && (
        <div className="flex gap-2">
          <button className={primaryStyle} disabled={mutation.isPending}>
            {t('admin.save')}
          </button>
          {onCancel && (
            <button type="button" className={actionStyle} onClick={onCancel}>
              {t('admin.cancel')}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
