import { OutputSchemas } from '../schemas/outputs.js';
import { getCapability, computeCompleteness, prepareReportData, PROMPT_VERSION } from '../capabilities/index.js';
import { checkNumbers } from './number-check.js';
import { checkLabels } from './label-check.js';
import { profileData } from './data-quality.js';
import { computeUnavailable } from './kpis.js';
import { detectFindings, findingNumbers } from './findings.js';
import { ClaimsReplySchema, validateClaims, renderReport, buildClaimsFallback } from './claims.js';
import { checkClaims, rejectedOf } from './claim-rules.js';
import { config } from '../config.js';
import { computeConfidence } from './confidence.js';
import { createLlm, PRIMARY_MODEL } from './llm.js';
import { createCallback } from './callback.js';
import { extractJsonObject, ModelOutputError } from './parse.js';
import { classifyProviderError } from './errors.js';
import { logger } from '../logger.js';

const MAX_ATTEMPTS = 2; // first call + ONE controlled repair retry (never more)

function fail(kind, code, message, extra = {}) {
  return { ok: false, error: { kind, code, message, ...extra } };
}

// Keep only the keys the output schema knows; the model may add chatter keys
// (e.g. "notes", "confidence") that would otherwise trip the strict schema.
function pruneToSchema(parsed, capabilityId) {
  const known = new Set(Object.keys(OutputSchemas[capabilityId].shape));
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => known.has(key)));
}

function validateReply(result, { kpis, capabilityId, locale, ranking, data, findings, insights, mode, finalAttempt, claimRules }) {
  let parsed;
  try {
    parsed = extractJsonObject(result.text);
  } catch (error) {
    if (error instanceof ModelOutputError) {
      if (result.finishReason === 'length') {
        return fail('parse', 'MODEL_OUTPUT_TRUNCATED', 'model hit the token limit before finishing the answer');
      }
      return fail('parse', error.code, error.message);
    }
    throw error;
  }

  try {
    let candidate;
    if (mode === 'claims') {
      // The model writes typed claims about code-detected findings; code renders them
      // into the report fields (and adds code statements for any top finding it skipped).
      const reply = {
        ...(typeof parsed.headline === 'string' && parsed.headline.trim() ? { headline: parsed.headline } : {}),
        claims: Array.isArray(parsed.claims)
          ? parsed.claims.map((c) => ({ kind: c?.kind, findingIds: c?.findingIds ?? [], text: c?.text }))
          : parsed.claims,
      };
      const shape = ClaimsReplySchema.safeParse(reply);
      if (!shape.success) return fail('validation', 'SCHEMA_INVALID', String(shape.error.message).slice(0, 400));
      const structure = validateClaims(shape.data, insights);
      if (!structure.ok) return fail('validation', structure.code, structure.detail);
      // Deterministic claim rules (causality, grounding, undefined terms, direction, data conflicts).
      // First attempt: any rejection triggers the one repair retry with a precise hint.
      // Final attempt: the offending claims (or headline) are removed, never shown; the report is
      // built from the rest plus code statements for any top finding left uncovered.
      const ruled = claimRules ? checkClaims({ reply: shape.data, findings: insights, capabilityId, kpis, data }) : { reply: shape.data, violations: [] };
      const rejects = ruled.violations.filter((v) => v.action === 'reject');
      if (rejects.length > 0 && !finalAttempt) {
        return fail('validation', 'CLAIM_RULES', rejects.map((v) => `${v.where}: ${v.code}`).join('; '), {
          offending: rejects.map((v) => ({ where: v.where, code: v.code, detail: v.detail })),
        });
      }
      candidate = { ...renderReport(capabilityId, ruled.reply, insights, locale, data, { rejected: rejectedOf(ruled.violations), rejectedClaims: ruled.rejectedClaims ?? [] }), locale, kpis };
    } else {
      candidate = { ...pruneToSchema(parsed, capabilityId), locale, kpis };
      delete candidate.insights; // never from the model
    }
    // Data-quality findings are code-computed, like kpis: never taken from the model.
    if (findings.length > 0) candidate.dataQuality = findings;
    else delete candidate.dataQuality;
    if (capabilityId === 'sales_performance') candidate.ranking = ranking;

    if (capabilityId === 'animateur_coaching' && Array.isArray(candidate.coaching)) {
      const allowed = new Set((Array.isArray(data?.animateurs) ? data.animateurs : []).map((a) => String(a?.label)));
      for (const item of candidate.coaching) {
        if (!allowed.has(String(item?.label))) {
          return fail('validation', 'UNKNOWN_LABEL', `unknown animateur label: ${String(item?.label).slice(0, 20)}`);
        }
      }
    }

    const output = OutputSchemas[capabilityId].parse(candidate);
    const labelCheck = checkLabels(output, data, kpis, capabilityId);
    if (!labelCheck.ok) {
      return fail('validation', 'UNKNOWN_LABEL', `labels not found in the supplied data: ${labelCheck.unknown.join(', ')}`, {
        offending: labelCheck.unknown,
      });
    }
    const numberCheck = checkNumbers(output, kpis, data, findingNumbers(insights));
    if (!numberCheck.ok) {
      return fail('validation', 'INVENTED_NUMERALS', `numbers not found in the supplied data: ${numberCheck.offending.join(', ')}`, {
        offending: numberCheck.offending,
        contexts: numberCheck.contexts,
      });
    }
    return { ok: true, output };
  } catch (error) {
    return fail('validation', 'SCHEMA_INVALID', String(error?.message ?? error).slice(0, 400));
  }
}

// `claimRules: false` exists ONLY so the offline benchmark can measure the claims pipeline without the
// P4 rules (before/after). The server never passes it, and no environment variable controls it.
export function createPipeline({ llm, callback, outputMode, claimRules = true } = {}) {
  const mode = outputMode ?? config.OUTPUT_MODE;
  const agent = llm ?? createLlm();
  const cb = callback ?? createCallback();
  const seen = new Map();
  const pending = new Map();

  async function process(request, capabilityId) {
    const cap = getCapability(capabilityId);
    if (!cap) throw new Error('UNKNOWN_CAPABILITY');

    const locale = request.input.context.locale;
    let data;
    try {
      // Deterministic PII firewall at the pipeline boundary.
      data = prepareReportData(capabilityId, request.input.context.data ?? {});
    } catch (error) {
      if (error.code === 'PII_FIREWALL') {
        const output = {
          error: {
            code: 'PII_FIREWALL',
            message: 'Request payload contains personal or file data; only counts, codes and short labels may be sent.',
          },
        };
        const payload = {
          requestId: request.requestId,
          capability: capabilityId,
          modelVersion: 'none@pii-firewall',
          confidence: 0,
          output,
        };
        const delivery = await cb.post(payload);
        return { ...payload, delivery, status: 'pii_rejected' };
      }
      throw error;
    }
    const kpis = cap.computeKpis(data);
    const findings = profileData(capabilityId, data);
    const unavailable = computeUnavailable(capabilityId, data);
    const insights = mode === 'claims' ? detectFindings(capabilityId, data, findings) : [];
    const completeness = computeCompleteness(capabilityId, data);
    const ranking = cap.computeRanking ? cap.computeRanking(data) : [];

    if (completeness === 0) {
      const output = { error: { code: 'NEEDS_DATA', message: 'No usable aggregate data was supplied.' } };
      const payload = {
        requestId: request.requestId,
        capability: capabilityId,
        modelVersion: 'none@no-data',
        confidence: 0,
        output,
      };
      const delivery = await cb.post(payload);
      return { ...payload, delivery, status: 'needs_data' };
    }

    const context = { kpis, capabilityId, locale, ranking, data, findings, insights, mode, claimRules };
    const attempts = [];
    let output = null;
    let modelUsed = PRIMARY_MODEL;
    let state = 'fallback';
    let failure = null;
    let previousReply = null;

    // Qwen is the only configured model. Attempt 1 is the normal call; attempt 2
    // is ONE repair retry, used only when the reply was received but was
    // unparseable or failed validation. Provider errors (timeout, 429, 5xx, auth)
    // are never retried here: they go straight to the deterministic fallback.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let result;
      try {
        const prompt = cap.buildPrompt({ locale, kpis, data, findings, insights, mode, unavailable, validationError: failure, previousReply });
        result = await agent.generate({ ...prompt, model: PRIMARY_MODEL });
        modelUsed = result.model;
      } catch (error) {
        failure = { kind: 'provider', code: classifyProviderError(error), message: String(error?.message ?? error).slice(0, 300) };
        attempts.push({ attempt, ...failure });
        break;
      }
      const checked = validateReply(result, { ...context, finalAttempt: attempt === MAX_ATTEMPTS });
      if (checked.ok) {
        output = checked.output;
        state = attempt === 1 ? 'first_pass' : 'repaired';
        attempts.push({ attempt, kind: 'ok', code: 'OK' });
        break;
      }
      failure = checked.error;
      previousReply = result.text;
      attempts.push({ attempt, ...failure });
    }

    let fallbackReason = null;
    if (!output) {
      // Deterministic templated report: the final safety mechanism. It is NOT
      // presented as AI output: modelVersion carries "deterministic-fallback",
      // confidence is 0, and output.fallback records why it was used.
      fallbackReason = failure?.code ?? 'UNKNOWN';
      output = {
        ...(mode === 'claims'
          ? buildClaimsFallback(capabilityId, locale, kpis, ranking, findings, insights, data)
          : cap.fallback(locale, kpis, ranking, findings)),
        fallback: { used: true, reasonCode: fallbackReason, attempts: attempts.length },
      };
      modelUsed = `${modelUsed}@deterministic-fallback`;
      logger.warn({ capabilityId, fallbackReason, attempts }, 'deterministic fallback used');
    } else if (state === 'repaired') {
      logger.info({ capabilityId, attempts }, 'qwen output accepted after repair retry');
    }

    const confidence = computeConfidence(completeness, state);
    const payload = {
      requestId: request.requestId,
      capability: capabilityId,
      modelVersion: `${modelUsed}@${PROMPT_VERSION}`,
      confidence,
      output,
    };
    const delivery = await cb.post(payload);
    return {
      ...payload,
      delivery,
      status: delivery.ok ? 'completed' : 'callback_failed',
      // Local diagnostics only; never part of the callback payload.
      diagnostics: { state, fallbackReason, attempts },
    };
  }

  function enqueue(request, capabilityId) {
    const cached = seen.get(request.requestId);
    if (cached) return { duplicate: true, result: cached };

    const inFlight = pending.get(request.requestId);
    if (inFlight) return { duplicate: true, promise: inFlight };

    const promise = process(request, capabilityId)
      .then((result) => {
        if (result.delivery.ok) seen.set(request.requestId, result);
        return result;
      })
      .catch((error) => {
        logger.error({ err: error, requestId: request.requestId }, 'pipeline failed');
        throw error;
      })
      .finally(() => pending.delete(request.requestId));

    pending.set(request.requestId, promise);
    promise.catch(() => {});
    return { duplicate: false, promise };
  }

  function waitFor(requestId) {
    return pending.get(requestId) ?? Promise.resolve(seen.get(requestId));
  }

  return { enqueue, waitFor, process, seen };
}
