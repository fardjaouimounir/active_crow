// Robust extraction of ONE JSON object from a chat-model reply.
// Handles Qwen-style <think>…</think> blocks (closed, unclosed, or with a
// missing opening tag), Markdown code fences and explanatory text around the
// JSON. Throws ModelOutputError with a specific code when extraction fails;
// it never guesses or repairs the content of the JSON itself.

export class ModelOutputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelOutputError';
    this.code = code;
  }
}

const THINK_BLOCK = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi;
const THINK_OPEN = /<think(?:ing)?>/i;
const THINK_CLOSE = /<\/think(?:ing)?>/i;

function stripReasoning(text) {
  let out = text.replace(THINK_BLOCK, '');
  const open = out.search(THINK_OPEN);
  if (open !== -1) {
    // Unclosed block: the model ran out of budget while reasoning.
    out = out.slice(0, open);
    if (!out.trim()) {
      throw new ModelOutputError(
        'MODEL_TRUNCATED_REASONING',
        'reply contains only an unterminated <think> block (no answer was produced)',
      );
    }
  }
  const close = out.search(THINK_CLOSE);
  if (close !== -1) {
    // Some chat templates pre-fill the opening tag, so only "</think>" appears.
    out = out.slice(close).replace(THINK_CLOSE, '');
  }
  return out.trim();
}

// Returns top-level balanced {...} spans, honouring JSON string escapes.
function balancedObjects(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') {
      i += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      spans.push({ text: text.slice(i), complete: false });
      break;
    }
    spans.push({ text: text.slice(i, end + 1), complete: true });
    i = end + 1;
  }
  return spans;
}

function parseCandidates(source, found) {
  let sawIncomplete = false;
  for (const span of balancedObjects(source)) {
    if (!span.complete) {
      sawIncomplete = true;
      continue;
    }
    try {
      const value = JSON.parse(span.text);
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
        found.push(value);
      }
    } catch {
      // not valid JSON; try the next span
    }
  }
  return sawIncomplete;
}

export function extractJsonObject(raw) {
  const original = String(raw ?? '');
  if (!original.trim()) {
    throw new ModelOutputError('MODEL_EMPTY_RESPONSE', 'model returned empty content');
  }
  const text = stripReasoning(original);
  if (!text) {
    throw new ModelOutputError('MODEL_EMPTY_RESPONSE', 'model returned only reasoning and no answer');
  }

  const found = [];
  let incomplete = false;
  const fenced = [...text.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const block of fenced) incomplete = parseCandidates(block, found) || incomplete;
  if (found.length === 0) incomplete = parseCandidates(text, found) || incomplete;

  if (found.length > 0) return found[found.length - 1];
  if (incomplete) {
    throw new ModelOutputError('MODEL_JSON_PARSE_FAILED', 'JSON object is incomplete (reply was cut off or unbalanced)');
  }
  if (!text.includes('{')) {
    throw new ModelOutputError('MODEL_JSON_PARSE_FAILED', 'no JSON object found in the reply');
  }
  throw new ModelOutputError('MODEL_JSON_PARSE_FAILED', 'a JSON-like object was found but it is not valid JSON');
}
