// Opt-in real-model smoke test. Run with:
//   node --env-file=.env scripts/smoke.js
// It calls the configured AI Grid model through the production adapter.
// Never runs in CI unless RUN_AI_GRID_SMOKE=true.
import { createLlm, PRIMARY_MODEL } from '../src/pipeline/llm.js';

const agent = createLlm();
const prompt = {
  system: 'Return ONLY one JSON object, no prose, no code fences.',
  user: 'Reply with the exact JSON: {"ok":true}',
};

const started = Date.now();
try {
  const { text, model } = await agent.generate(prompt);
  console.log(`${PRIMARY_MODEL}: OK (${Date.now() - started}ms) model=${model} -> ${text.slice(0, 120)}`);
} catch (error) {
  const msg = String(error?.message ?? error);
  const kind = msg.includes('403') || msg.toLowerCase().includes('not allowed')
    ? 'MODEL_ACCESS_DENIED (check this key is allowed to access the model)'
    : msg.includes('401')
      ? 'AUTH_FAILED (check LLM_API_KEY)'
      : 'REQUEST_FAILED';
  console.log(`${PRIMARY_MODEL}: FAILED (${Date.now() - started}ms) ${kind} -> ${msg}`);
  process.exitCode = 1;
}
