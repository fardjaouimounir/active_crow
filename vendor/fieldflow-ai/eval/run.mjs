// Benchmark runner.
//   node eval/run.mjs --mode recorded [--file eval/recorded/baseline.json]
//   node --env-file=.env eval/run.mjs --mode live [--runs 1] [--concurrency 3] --record --file recorded/<new-name>.json
// Flags: --set heldout, --no-claim-rules (evaluation only), --force (allow overwriting a recording).
// Safety: --record needs an explicit --file that does not exist yet; progress is saved every 10 cases
// to <file>.partial.json, so an interrupted or failing run is never lost.
// Filters: --cap <capability> --locale <ar|en> --id <scenario id>
// Live mode calls the real model through the production pipeline; the callback
// is stubbed (nothing is sent to FieldFlow). Only labels and aggregate figures
// are ever sent, exactly as in production.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SCENARIOS, buildRequest } from './scenarios.mjs';
import { HELDOUT } from './scenarios-heldout.mjs';
import { judge, CRITICAL_CODES } from './judge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args.set(a.slice(2), next); i += 1; } else args.set(a.slice(2), true);
  }
}
const mode = args.get('mode') ?? 'recorded';
const runs = Number(args.get('runs') ?? 1);
const concurrency = Number(args.get('concurrency') ?? 3);
const recordFile = path.resolve(HERE, String(args.get('file') && args.get('file') !== true ? args.get('file') : 'recorded/baseline.json'));

const pool = args.get('set') === 'heldout' ? HELDOUT : SCENARIOS;
const scenarios = pool.filter((s) => (!args.get('cap') || s.cap === args.get('cap')) && (!args.get('id') || s.id === args.get('id')));
const locales = args.get('locale') ? [args.get('locale')] : ['en', 'ar'];

// A recording must never silently replace a previous measurement: the old default file was the committed
// P1 baseline, and nothing refused to overwrite an existing file.
export function guardRecordTarget({ mode, record, file, force }, exists = fs.existsSync) {
  if (mode !== 'live' || !record) return null;
  if (typeof file !== 'string' || file.length === 0) {
    return 'refusing to record without an explicit --file (e.g. --file recorded/p4b-design-rules-on.json)';
  }
  const target = path.resolve(HERE, file);
  if (exists(target) && !force) return 'refusing to overwrite ' + path.relative(process.cwd(), target) + ': use a new file name (or --force if you really mean it)';
  return null;
}

export function writeRecording(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 1) + '\n');
  fs.renameSync(tmp, file); // atomic: a crash never leaves a half-written recording
}
export const partialPath = (file) => file.replace(/\.json$/, '') + '.partial.json';

const PROVIDER_ERRORS = /^AI_(UNAVAILABLE|MODEL_TIMEOUT|RATE_LIMITED)$/;
export const providerErrorCases = (records) => records.filter((r) => PROVIDER_ERRORS.test(r.diagnostics?.fallbackReason ?? ''));

function gitHead() {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.resolve(HERE, '..'), encoding: 'utf8' }).trim(); } catch { return null; }
}

async function collectLive() {
  const { createPipeline } = await import('../src/pipeline/index.js');
  const { PROMPT_VERSION } = await import('../src/capabilities/index.js');
  const { config } = await import('../src/config.js');
  const meta = {
    startedAt: new Date().toISOString(), runs, concurrency, locales, set: args.get('set') === 'heldout' ? 'heldout' : 'design',
    filters: { cap: args.get('cap') ?? null, id: args.get('id') ?? null },
    outputMode: config.OUTPUT_MODE, claimRules: !args.get('no-claim-rules'), promptVersion: PROMPT_VERSION, model: config.LLM_MODEL, gitHead: gitHead(),
  };
  const pipeline = createPipeline({ callback: { post: async () => ({ ok: true, status: 200 }) }, ...(args.get('no-claim-rules') ? { claimRules: false } : {}) });
  const jobs = [];
  for (const scenario of scenarios) for (const locale of locales) for (let run = 1; run <= runs; run += 1) jobs.push({ scenario, locale, run });
  const out = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { scenario, locale, run } = jobs[next++];
      const started = Date.now();
      let r;
      try {
        r = await pipeline.process(buildRequest(scenario, locale, crypto.randomUUID()), scenario.cap);
      } catch (error) {
        r = { output: { error: { code: 'RUNNER_EXCEPTION', message: String(error?.message ?? error).slice(0, 100) } }, diagnostics: {} };
      }
      out.push({
        id: scenario.id, locale, run, ms: Date.now() - started,
        modelVersion: r.modelVersion ?? null, output: r.output,
        diagnostics: { state: r.diagnostics?.state ?? null, fallbackReason: r.diagnostics?.fallbackReason ?? null, attempts: (r.diagnostics?.attempts ?? []).map((a) => a.code) },
      });
      process.stderr.write(`\r${out.length}/${jobs.length}`);
      if (args.get('record') && typeof args.get('file') === 'string' && out.length % 10 === 0) {
        writeRecording(partialPath(recordFile), { meta: { ...meta, partial: true, done: out.length, total: jobs.length }, records: out });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  process.stderr.write('\n');
  return { records: out, meta };
}

function collectRecorded() {
  const file = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  const records = file.records.filter((r) => scenarios.some((s) => s.id === r.id) && locales.includes(r.locale));
  return { records, meta: file.meta ?? { runs: file.runs, recordedAt: file.recordedAt } };
}

const pct = (n, d) => (d === 0 ? 'n/a' : `${Math.round((n / d) * 1000) / 10}%`);
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null);

export function summarise(records) {
  const byId = new Map([...SCENARIOS, ...HELDOUT].map((s) => [s.id, s]));
  const results = records.map((rec) => {
    const scenario = byId.get(rec.id);
    return { rec, scenario, verdict: judge({ scenario, locale: rec.locale, output: rec.output, diagnostics: rec.diagnostics }) };
  });
  const judged = results.filter((r) => r.verdict.status === 'judged');
  const failed = judged.filter((r) => r.verdict.critical.length > 0);
  const ai = judged.filter((r) => r.rec.diagnostics.state === 'first_pass' || r.rec.diagnostics.state === 'repaired');
  const aiFailed = ai.filter((r) => r.verdict.critical.length > 0);
  const codeCount = {};
  for (const r of judged) for (const c of new Set(r.verdict.critical.map((x) => x.code))) codeCount[c] = (codeCount[c] ?? 0) + 1;
  const nonKpi = judged.filter((r) => r.verdict.critical.some((c) => !c.code.startsWith('KPI_')));
  const fallbackReasons = {};
  for (const r of results) if (r.rec.diagnostics.fallbackReason) fallbackReasons[r.rec.diagnostics.fallbackReason] = (fallbackReasons[r.rec.diagnostics.fallbackReason] ?? 0) + 1;

  const groups = {};
  for (const r of results) {
    const key = `${r.scenario.cap} / ${r.rec.locale}`;
    (groups[key] ??= []).push(r);
  }
  const table = Object.entries(groups).map(([key, rs]) => {
    const j = rs.filter((r) => r.verdict.status === 'judged');
    return {
      group: key, n: rs.length,
      criticalRate: pct(j.filter((r) => r.verdict.critical.length > 0).length, j.length),
      nonKpiCriticalRate: pct(j.filter((r) => r.verdict.critical.some((c) => !c.code.startsWith('KPI_'))).length, j.length),
      fallbackRate: pct(rs.filter((r) => r.rec.diagnostics.state === 'fallback').length, rs.length),
      repairRate: pct(rs.filter((r) => r.rec.diagnostics.state === 'repaired').length, rs.length),
      meanScore: mean(j.map((r) => r.verdict.score).filter((x) => x !== null)),
    };
  });
  const dimMeans = {};
  for (const d of ['coverage', 'prioritisation', 'evidence', 'relevance', 'locale']) {
    dimMeans[d] = mean(judged.map((r) => r.verdict.dims[d]).filter((x) => x !== undefined));
  }
  return {
    total: results.length, judged: judged.length, noOutput: results.length - judged.length,
    criticalFailures: failed.length, criticalRate: pct(failed.length, judged.length),
    nonKpiCriticalFailures: nonKpi.length, nonKpiCriticalRate: pct(nonKpi.length, judged.length),
    aiAccepted: ai.length, aiAcceptedWithCritical: aiFailed.length, aiAcceptedCriticalRate: pct(aiFailed.length, ai.length),
    passRate: pct(judged.filter((r) => r.verdict.passed).length, judged.length),
    fallbackRate: pct(results.filter((r) => r.rec.diagnostics.state === 'fallback').length, results.length),
    repairRate: pct(results.filter((r) => r.rec.diagnostics.state === 'repaired').length, results.length),
    meanScore: mean(judged.map((r) => r.verdict.score).filter((x) => x !== null)),
    dimMeans, criticalByCode: Object.fromEntries(CRITICAL_CODES.filter((c) => codeCount[c]).map((c) => [c, codeCount[c]])),
    fallbackReasons, table,
    failures: failed.map((r) => ({ id: r.rec.id, locale: r.rec.locale, state: r.rec.diagnostics.state, critical: r.verdict.critical })),
  };
}

function markdown(s, label, meta) {
  const lines = [`# Benchmark report (${label})`, '', ...(meta ? ['Recording: ' + Object.entries(meta).filter(([k]) => !['filters', 'locales', 'startedAt'].includes(k)).map(([k, v]) => k + '=' + v).join(', '), ''] : []),
    `Cases: ${s.total} (judged ${s.judged}, no output ${s.noOutput}); scenarios ${new Set(s.failures.map((f) => f.id)).size} with a critical failure`,
    '', '| Metric | Value |', '|---|---|',
    `| Critical-failure rate (all judged) | **${s.criticalRate}** (${s.criticalFailures}) |`,
    `| Critical-failure rate excluding KPI undefined/zero issues | ${s.nonKpiCriticalRate} (${s.nonKpiCriticalFailures}) |`,
    `| AI-accepted outputs that still contain a critical error | **${s.aiAcceptedCriticalRate}** (${s.aiAcceptedWithCritical} of ${s.aiAccepted}) |`,
    `| Pass rate (no critical and score >= 0.7) | ${s.passRate} |`,
    `| Fallback rate / repair rate | ${s.fallbackRate} / ${s.repairRate} |`,
    `| Mean score | ${s.meanScore} |`,
    `| Dimension means | ${Object.entries(s.dimMeans).map(([k, v]) => `${k} ${v}`).join(', ')} |`,
    '', '## Critical failures by code (cases)', '', ...Object.entries(s.criticalByCode).map(([k, v]) => `- ${k}: ${v}`),
    '', '## Fallback reasons', '', ...(Object.entries(s.fallbackReasons).map(([k, v]) => `- ${k}: ${v}`)),
    '', '## By capability and locale', '', '| Group | n | Critical | Critical (non-KPI) | Fallback | Repaired | Mean score |', '|---|---|---|---|---|---|---|',
    ...s.table.map((t) => `| ${t.group} | ${t.n} | ${t.criticalRate} | ${t.nonKpiCriticalRate} | ${t.fallbackRate} | ${t.repairRate} | ${t.meanScore} |`)];
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problem = guardRecordTarget({ mode, record: args.get('record'), file: args.get('file'), force: args.get('force') });
  if (problem) { console.error(problem); process.exit(2); }
  const { records, meta } = mode === 'live' ? await collectLive() : collectRecorded();
  if (mode === 'live' && args.get('record')) {
    writeRecording(recordFile, { recordedAt: new Date().toISOString(), runs, meta: { ...meta, finishedAt: new Date().toISOString() }, records });
    fs.rmSync(partialPath(recordFile), { force: true });
    process.stderr.write(`recorded ${records.length} cases -> ${path.relative(process.cwd(), recordFile)}\n`);
  }
  const providerErrors = providerErrorCases(records);
  if (providerErrors.length > 0) {
    process.stderr.write('WARNING: ' + providerErrors.length + ' case(s) fell back because of provider errors (' + [...new Set(providerErrors.map((r) => r.diagnostics.fallbackReason))].join(', ') + '): ' + [...new Set(providerErrors.map((r) => r.id))].join(' ') + '. They measure nothing: re-run them into a NEW file (--id / --cap).\n');
  }
  const summary = summarise(records);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(HERE, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'reports', `${mode}-${stamp}.json`), `${JSON.stringify(summary, null, 1)}\n`);
  const md = markdown(summary, mode, meta);
  fs.writeFileSync(path.join(HERE, 'reports', `${mode}-latest.md`), `${md}\n`);
  console.log(md);
  if (args.get('verbose')) for (const f of summary.failures) console.log(`${f.id} ${f.locale} [${f.state}] ${f.critical.map((c) => `${c.code}(${c.detail})`).join('; ')}`);
}
