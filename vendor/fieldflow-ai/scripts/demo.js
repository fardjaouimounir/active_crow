import fs from 'node:fs';
import path from 'node:path';
import { createPipeline } from '../src/pipeline/index.js';
import { createCallback } from '../src/pipeline/callback.js';
import { createLlm } from '../src/pipeline/llm.js';
import { getCapability } from '../src/capabilities/index.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--capability') out.capability = argv[++i];
    if (argv[i] === '--fixture') out.fixture = argv[++i];
    if (argv[i] === '--locale') out.locale = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const capability = args.capability ?? 'supervisor_daily_summary';
const cap = getCapability(capability);
if (!cap) {
  console.error(`Unknown capability: ${capability}`);
  process.exit(1);
}

const fixturePath = args.fixture
  ? path.resolve(args.fixture)
  : path.resolve(`fixtures/${capability}/happy.json`);
const request = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
if (args.locale) request.input.context.locale = args.locale;

const locale = request.input.context.locale;
const data = request.input.context.data ?? {};
const kpis = cap.computeKpis(data);
const ranking = cap.computeRanking ? cap.computeRanking(data) : [];

// Deterministic local model stub: the demo exercises the whole pipeline with no network.
const llm = createLlm({
  callModel: async () => JSON.stringify(cap.fallback(locale, kpis, ranking)),
});

const delivered = [];
const callback = createCallback({
  key: 'demo-service-key',
  fetchImpl: async (_url, init) => {
    delivered.push(JSON.parse(init.body));
    return { ok: true, status: 200 };
  },
  sleep: async () => {},
});

const pipeline = createPipeline({ llm, callback });
const result = await pipeline.process(request, capability);

console.log(`capability : ${capability}`);
console.log(`locale     : ${locale}`);
console.log(`model      : ${result.modelVersion}`);
console.log(`confidence : ${result.confidence}`);
console.log(`callback   : ${result.delivery.ok ? 'ok' : result.delivery.error}`);
console.log('--- output ---');
console.log(JSON.stringify(result.output, null, 2));
console.log('--- callback payload (first) ---');
console.log(JSON.stringify(delivered[0], null, 2));
