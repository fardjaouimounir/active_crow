import { z } from 'zod';

const Locale = z.enum(['ar', 'en']);
const Kpis = z.record(z.number().finite());
// Code-detected data-quality findings (additive, optional; present only when there are findings).
const DataQuality = z
  .array(z.object({ code: z.string().min(1), severity: z.enum(['conflict', 'missing', 'info']) }).strict())
  .optional();

// Code-detected findings and the typed claims rendered into this report (additive, optional).
const Insights = z
  .object({
    findings: z.array(z.object({
      id: z.string(), type: z.string(), scope: z.enum(['group', 'entity']), entity: z.string().nullable(),
      polarity: z.enum(['adverse', 'positive', 'neutral', 'data', 'cause']), rank: z.number().int().positive(),
      code: z.string().optional(), severity: z.string().optional(), lean: z.enum(['weak']).optional(),
      values: z.record(z.number()),
    }).strict()),
    claims: z.array(z.object({
      kind: z.enum(['observation', 'interpretation', 'hypothesis', 'recommendation']),
      findingIds: z.array(z.string()), text: z.string().min(1), source: z.enum(['model', 'code']),
      // set when a hedged cause stated as another kind was reclassified as a hypothesis
      downgradedFrom: z.enum(['observation', 'interpretation', 'recommendation']).optional(),
    }).strict()),
    // claims removed by the claim rules (reason + kind only; the rejected text is never shown)
    rejected: z.array(z.object({ reason: z.string(), kind: z.string() }).strict()).optional(),
  })
  .strict()
  .optional();

const SupervisorDailySummary = z
  .object({
    locale: Locale,
    headline: z.string().min(1),
    summary: z.array(z.string().min(1)).min(3).max(5),
    attention: z
      .array(
        z
          .object({
            type: z.string().min(1),
            text: z.string().min(1),
            refs: z.array(z.string()),
          })
          .strict(),
      )
      .default([]),
    recommendedActions: z.array(z.string().min(1)).max(3).default([]),
    kpis: Kpis,
    dataQuality: DataQuality,
    insights: Insights,
  })
  .strict();

const SalesPerformance = z
  .object({
    locale: Locale,
    ranking: z.array(z.string().min(1)).default([]),
    trends: z.array(z.string().min(1)).default([]),
    anomalies: z.array(z.string().min(1)).default([]),
    recommendedActions: z.array(z.string().min(1)).default([]),
    kpis: Kpis,
    dataQuality: DataQuality,
    insights: Insights,
  })
  .strict();

const CampaignInsights = z
  .object({
    locale: Locale,
    narrative: z.string().min(1),
    risks: z
      .array(
        z
          .object({
            severity: z.enum(['low', 'medium', 'high']),
            text: z.string().min(1),
            evidence: z.array(z.string()),
          })
          .strict(),
      )
      .default([]),
    opportunities: z.array(z.string().min(1)).default([]),
    decisions: z.array(z.string().min(1)).default([]),
    kpis: Kpis,
    dataQuality: DataQuality,
    insights: Insights,
  })
  .strict();

const AnimateurCoaching = z
  .object({
    locale: Locale,
    coaching: z
      .array(
        z
          .object({
            label: z.string().min(1),
            strengths: z.array(z.string()).default([]),
            gaps: z.array(z.string()).default([]),
            actions: z.array(z.string()).default([]),
            evidenceRefs: z.array(z.string()).default([]),
          })
          .strict(),
      )
      .default([]),
    campaignActions: z.array(z.string().min(1)).default([]),
    kpis: Kpis,
    dataQuality: DataQuality,
    insights: Insights,
  })
  .strict();

export const OutputSchemas = {
  supervisor_daily_summary: SupervisorDailySummary,
  sales_performance: SalesPerformance,
  campaign_insights: CampaignInsights,
  animateur_coaching: AnimateurCoaching,
};

// Keys that are structural, not prose. Number check skips these.
export const NON_PROSE_KEYS = new Set([
  'kpis',
  'dataQuality',
  'insights',
  'locale',
  'label',
  'refs',
  'evidenceRefs',
  'evidence',
  'type',
  'severity',
  'rank',
  'ranking',
]);
