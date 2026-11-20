import { ScanSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buttonClass } from '../../ui/primitives.jsx';
import { useCan } from '../../shared/auth/hooks.js';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useAiCommentary, useAiRequests, useRequestSuggestion } from './api.js';
import { messages } from './messages.js';

export function useAiText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const rtl = language.startsWith('ar');
  const locale = rtl ? 'ar-DZ-u-nu-latn' : 'en-GB';
  const t = (key, values = {}) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
      messages[key]?.[rtl ? 1 : 0] ?? key,
    );
  const date = (value) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'Africa/Algiers', dateStyle: 'medium' }).format(
      new Date(value),
    );
  const dateTime = (value) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: 'Africa/Algiers',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  const percent = (value) =>
    value == null
      ? '—'
      : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value);
  const number = (value) => (value == null ? '—' : new Intl.NumberFormat(locale).format(value));
  return { t, rtl, language, locale, date, dateTime, percent, number };
}

/** Request state shown next to a button: queued, waiting, ready for review, failed. */
export function requestState(request) {
  if (!request) return null;
  if (request.status === 'send_failed') return 'failed';
  if (request.status === 'queued' || request.status === 'sent') return request.status;
  if (request.suggestion?.failure) return 'failed';
  const decided = request.suggestion?.status;
  return decided === 'accepted' || decided === 'rejected' ? decided : 'ready';
}

/** Marks anything the model wrote: icon + text, shown wherever an AI suggestion appears. */
export function AiBadge() {
  const { t } = useAiText();
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-md border border-accent-line bg-accent-soft px-1.5 text-xs font-medium text-accent-text">
      <ScanSearch aria-hidden="true" size={12} strokeWidth={2} />
      {t('aiGenerated')}
    </span>
  );
}

const toneOf = { failed: 'text-danger', ready: 'text-success', accepted: 'text-success' };

/**
 * One AI button with its request status. Hidden when the AI module is off or the role cannot ask.
 * `blockedReason` disables the button with a tooltip (e.g. no sales target).
 */
export function AiActionButton({ capability, subjectId, filters = {}, blockedReason }) {
  const { t, language } = useAiText();
  const allowed = useCan('ai.request');
  const requests = useAiRequests({ capability, subjectId, enabled: allowed });
  const create = useRequestSuggestion();
  const { message } = useApiError(create.error);
  if (!allowed || !requests.data?.meta?.enabled) return null;
  const latest = requests.data.data[0];
  const state = requestState(latest);
  const inFlight = state === 'queued' || state === 'sent';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        title={blockedReason ?? undefined}
        disabled={Boolean(blockedReason) || inFlight || create.isPending}
        className={buttonClass({ variant: 'secondary' })}
        onClick={() =>
          create.mutate({
            capability,
            subjectId,
            locale: language.startsWith('ar') ? 'ar' : 'en',
            filters,
          })
        }
      >
        {t('action.' + capability)}
      </button>
      {state && (
        <span role="status" className={'text-sm ' + (toneOf[state] ?? 'text-fg-2')}>
          {t('state.' + state)}
        </span>
      )}
      {message && (
        <span role="alert" className="text-sm text-danger">
          {message}
        </span>
      )}
    </div>
  );
}

const list = (items) => (Array.isArray(items) ? items : []);
const text = (item) =>
  typeof item === 'string' ? item : typeof item?.text === 'string' ? item.text : '';

function Section({ title, children }) {
  return (
    <section className="space-y-1">
      <h4 className="text-sm font-semibold text-fg-2">{title}</h4>
      {children}
    </section>
  );
}

function Bullets({ items }) {
  const rows = list(items).map(text).filter(Boolean);
  if (!rows.length) return null;
  return (
    <ul className="list-disc space-y-1 ps-5 text-sm">
      {rows.map((row, index) => (
        <li key={index} dir="auto">
          {row}
        </li>
      ))}
    </ul>
  );
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const SEVERITY_TONE = {
  high: 'bg-danger-soft text-danger',
  medium: 'bg-warning-soft text-warning',
  low: 'bg-sunken text-fg-2',
};

/** Replaces the codes the AI service saw (A1, S2…) by the names kept on our side. */
export function useLabelName(labels) {
  return (label) => {
    const known = labels?.[label];
    return known?.type === 'user' && known.name ? known.name : label;
  };
}

/** Readable form of any capability output. Arabic text keeps its own direction (`dir="auto"`). */
export function AiOutput({ capability, output, labels }) {
  const { t } = useAiText();
  const name = useLabelName(labels);
  if (!output || output.error) {
    return (
      <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
        {t('failure.' + output?.error?.code)}
      </p>
    );
  }
  if (capability === 'campaign_insights') {
    const risks = [...list(output.risks)].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
    );
    return (
      <div className="space-y-3">
        <p dir="auto" className="text-sm">
          {output.narrative}
        </p>
        {risks.length > 0 && (
          <Section title={t('risks')}>
            <ul className="space-y-1 text-sm">
              {risks.map((risk, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-xs ' +
                      (SEVERITY_TONE[risk.severity] ?? SEVERITY_TONE.low)
                    }
                  >
                    {t('severity.' + risk.severity)}
                  </span>
                  <span dir="auto">{risk.text}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section title={t('opportunities')}>
          <Bullets items={output.opportunities} />
        </Section>
        <Section title={t('decisions')}>
          <Bullets items={output.decisions} />
        </Section>
      </div>
    );
  }
  if (capability === 'animateur_coaching') {
    return (
      <div className="space-y-3">
        {list(output.coaching).map((person, index) => (
          <article key={index} className="space-y-2 rounded-md border border-line p-3">
            <h4 className="font-semibold" dir="auto">
              {name(person.label)}
            </h4>
            <Section title={t('strengths')}>
              <Bullets items={person.strengths} />
            </Section>
            <Section title={t('gaps')}>
              <Bullets items={person.gaps} />
            </Section>
            <Section title={t('actions')}>
              <Bullets items={person.actions} />
            </Section>
          </article>
        ))}
        <Section title={t('campaignActions')}>
          <Bullets items={output.campaignActions} />
        </Section>
      </div>
    );
  }
  if (capability === 'sales_performance') {
    return (
      <div className="space-y-3">
        <Section title={t('ranking')}>
          <ol className="list-decimal space-y-1 ps-5 text-sm">
            {list(output.ranking).map((entry, index) => (
              <li key={index} dir="auto">
                {typeof entry === 'string' ? entry : `${name(entry.label)} — ${entry.units ?? ''}`}
              </li>
            ))}
          </ol>
        </Section>
        <Section title={t('trends')}>
          <Bullets items={output.trends} />
        </Section>
        <Section title={t('anomalies')}>
          <Bullets items={output.anomalies} />
        </Section>
        <Section title={t('recommendedActions')}>
          <Bullets items={output.recommendedActions} />
        </Section>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p dir="auto" className="font-medium">
        {output.headline}
      </p>
      <Bullets items={output.summary} />
      <Section title={t('attention')}>
        <Bullets items={output.attention} />
      </Section>
      <Section title={t('recommendedActions')}>
        <Bullets items={output.recommendedActions} />
      </Section>
    </div>
  );
}

/** The latest accepted suggestion next to a dashboard or report, labelled as AI-generated. */
export function AiCommentaryCard({ capability, subjectId, period }) {
  const { t, date } = useAiText();
  const canRequest = useCan('ai.request');
  const commentary = useAiCommentary(capability, subjectId, period);
  const row = commentary.data;
  if (!period?.from || !period?.to || commentary.isPending) return null;
  if (!row || row.failure)
    return canRequest ? (
      <p className="text-xs text-fg-3">
        {t('capabilityName.' + capability)}: {t('noneForPeriod')}
      </p>
    ) : null;
  return (
    <section className="space-y-3 rounded-lg border border-dashed border-accent-line bg-accent-soft/30 p-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <AiBadge />
          <h2 className="font-semibold tracking-tight">
            {t('commentary')} · {t('capabilityName.' + capability)}
          </h2>
        </div>
        <p className="text-xs text-fg-2">
          {t('period')}:{' '}
          <bdi dir="ltr">
            {row.filters?.from} – {row.filters?.to}
          </bdi>
        </p>
        <p className="text-xs text-fg-2">
          {t('reviewedBy', {
            name: row.reviewedBy?.name ?? '—',
            date: row.reviewedAt ? date(row.reviewedAt) : '—',
          })}
        </p>
      </header>
      <AiOutput capability={capability} output={row.output} labels={row.labels} />
    </section>
  );
}

const CAMPAIGN_CAPABILITIES = ['campaign_insights', 'animateur_coaching', 'sales_performance'];
const NEEDS_TARGET = new Set(['campaign_insights', 'sales_performance']);

/** AI buttons of one campaign (dashboard and final report). Needs a sales target for two of them. */
export function CampaignAiActions({ campaignId, period = {}, salesTarget }) {
  const { t } = useAiText();
  if (!campaignId) return null;
  const filters = period.from && period.to ? { from: period.from, to: period.to } : {};
  return (
    <div className="flex flex-wrap gap-3">
      {CAMPAIGN_CAPABILITIES.map((capability) => (
        <AiActionButton
          key={capability}
          capability={capability}
          subjectId={campaignId}
          filters={filters}
          blockedReason={
            NEEDS_TARGET.has(capability) && salesTarget == null ? t('needTarget') : undefined
          }
        />
      ))}
    </div>
  );
}

/** Accepted AI commentary of a campaign, one card per capability that has one. */
export function CampaignAiCards({ campaignId, period }) {
  if (!campaignId) return null;
  return (
    <>
      {CAMPAIGN_CAPABILITIES.map((capability) => (
        <AiCommentaryCard
          key={capability}
          capability={capability}
          subjectId={campaignId}
          period={period}
        />
      ))}
    </>
  );
}
