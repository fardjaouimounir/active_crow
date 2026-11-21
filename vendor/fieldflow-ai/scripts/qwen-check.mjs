// Real-provider check: calls Qwen on AI Grid for all 4 capabilities x ar/en using
// the happy fixtures, runs the full production pipeline (parse -> validate ->
// optional repair retry) and PRINTS ONLY pass/fail per stage. Nothing is sent to
// FieldFlow (callback is stubbed) and no key, prompt or reply text is printed.
//
//   npm run qwen:check          (reads .env via --env-file)
import fs from 'node:fs';
import { createPipeline } from '../src/pipeline/index.js';
import { assertSecrets } from '../src/config.js';

assertSecrets();
const CAPS = ['supervisor_daily_summary', 'sales_performance', 'campaign_insights', 'animateur_coaching'];
const load = (cap) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${cap}/happy.json`, import.meta.url), 'utf8'));

const pipeline = createPipeline({ callback: { post: async () => ({ ok: true, status: 200 }) } });
let aiOk = 0;
let total = 0;
for (const cap of CAPS) {
  for (const locale of ['en', 'ar']) {
    const body = structuredClone(load(cap));
    body.input.context.locale = locale;
    body.requestId = crypto.randomUUID();
    const started = Date.now();
    const r = await pipeline.process(body, cap);
    const d = r.diagnostics;
    total += 1;
    if (d.state !== 'fallback') aiOk += 1;
    const attempts = d.attempts.map((a) => `${a.kind}:${a.code}`).join(' -> ');
    const rejected = d.attempts.filter((a) => a.code === 'INVENTED_NUMERALS');
    console.log(
      `${cap.padEnd(26)} ${locale}  ${d.state === 'fallback' ? 'FALLBACK' : 'QWEN-OK '}  ` +
        `state=${d.state} confidence=${r.confidence} ${((Date.now() - started) / 1000).toFixed(1)}s  [${attempts}]`,
    );
    // Only on a numeric rejection: show the offending numbers and the sentence containing them
    // (model prose built from labels and supplied figures only; never keys or personal data).
    for (const a of rejected) {
      console.log(`    attempt ${a.attempt} rejected numbers: ${(a.offending ?? []).join(', ')}`);
      for (const c of a.contexts ?? []) console.log(`      > ${c}`);
    }
  }
}
console.log(`\nQwen output accepted: ${aiOk}/${total}`);
process.exit(aiOk === total ? 0 : 1);
