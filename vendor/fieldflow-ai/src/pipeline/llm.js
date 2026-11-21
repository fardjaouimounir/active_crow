import OpenAI from 'openai';
import { config } from '../config.js';

export const PRIMARY_MODEL = config.LLM_MODEL;

// Whether the configured provider advertises JSON-object mode. AI Grid's
// Chat Completions may not honour response_format, so keep it opt-in. The
// system prompt already instructs "return ONLY one JSON object" and
// parseModelJson tolerates fenced or unfenced JSON, so this is a graceful
// degradation knob, not a correctness requirement.
export const SUPPORTS_JSON_MODE = config.LLM_JSON_MODE === 'true';

const client = new OpenAI({
  baseURL: config.LLM_BASE_URL,
  apiKey: config.LLM_API_KEY,
  timeout: config.LLM_TIMEOUT_MS,
  maxRetries: 0,
});

function makeDefaultCaller() {
  return async ({ system, user, model, json = false }) => {
    const createArgs = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: config.LLM_TEMPERATURE,
      max_tokens: config.LLM_MAX_TOKENS,
    };
    if (json && SUPPORTS_JSON_MODE) {
      createArgs.response_format = { type: 'json_object' };
    }
    const response = await client.chat.completions.create(createArgs);
    const choice = response.choices?.[0]?.message;
    // Return the provider-reported model for provenance (not just what we asked for).
    const reportedModel = choice?.model ?? model;
    return {
      text: typeof choice?.content === 'string' ? choice.content : '',
      model: reportedModel,
      finishReason: response.choices?.[0]?.finish_reason ?? null,
    };
  };
}

// callModel is injectable so CI and tests never touch the network.
export function createLlm({ callModel } = {}) {
  const caller = callModel ?? makeDefaultCaller();
  return {
    async generate({ system, user, model = PRIMARY_MODEL, json = false }) {
      const result = await caller({ system, user, model, json });
      // Allow injectable callers to return either a string (legacy) or
      // { text, model } so CI stubs and the real provider both work.
      if (typeof result === 'string') {
        return { text: result, model };
      }
      const reportedModel = (result && typeof result.model === 'string' && result.model.length > 0)
        ? result.model
        : model;
      return {
        text: typeof result?.text === 'string' ? result.text : '',
        model: reportedModel,
        finishReason: result?.finishReason ?? null,
      };
    },
  };
}
