// HTTP client of the AI service: `POST {AI_SERVICE_BASE_URL}/v1/{capability}` with the inbound key.
// 202 (queued or cached) = accepted. 400/401 = permanent failure. 429, 5xx, network errors and
// timeouts throw a transient error so the job queue retries with the same requestId.
import { aiConfig } from './ai.config.js';

export class AiClientError extends Error {
  /** @param {string} message @param {{ permanent: boolean, status?: number }} details */
  constructor(message, { permanent, status }) {
    super(message);
    this.name = 'AiClientError';
    this.permanent = permanent;
    this.status = status;
  }
}

/**
 * @param {string} capability
 * @param {object} payload an already validated request body
 * @returns {Promise<{ status: 'queued' | 'cached' }>}
 */
export async function sendToAiService(capability, payload) {
  const { baseUrl, inboundKey, timeoutMs } = aiConfig.get();
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/${capability}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inboundKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new AiClientError(timedOut ? 'AI service timeout' : 'AI service unreachable', {
      permanent: false,
    });
  }
  if (response.status === 202) {
    const body = await response.json().catch(() => null);
    return { status: body?.data?.status === 'cached' ? 'cached' : 'queued' };
  }
  const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
  // The response body can echo request content; keep only the status in the error.
  throw new AiClientError(`AI service answered HTTP ${response.status}`, {
    permanent,
    status: response.status,
  });
}
