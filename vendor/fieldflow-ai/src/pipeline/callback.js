import { CALLBACK_URL, config } from '../config.js';

const DEFAULT_BACKOFF = [250, 500, 1000];

// Posts to FieldFlow's internal results route with a service key (never a user JWT).
// Retries only transient failures (429, 5xx, network/timeout) with exponential
// backoff; permanent 4xx responses are not retried. Each attempt is bounded by
// CALLBACK_TIMEOUT_MS so a black-holed endpoint cannot block the pipeline forever.
export function createCallback({
  url = CALLBACK_URL,
  fetchImpl = fetch,
  key = config.AI_SERVICE_OUTBOUND_KEY,
  backoffMs = DEFAULT_BACKOFF,
  timeoutMs = config.CALLBACK_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  function isTransient(error, status) {
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504)
      return true;
    const message = String(error?.message ?? '').toLowerCase();
    return message.includes('timeout') || message.includes('abort') || message.includes('fetch') || message.includes('network');
  }

  async function post(payload) {
    let lastError;
    for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
      let abortController;
      let response;
      try {
        abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) return { ok: true, status: response.status };
        const statusError = new Error(`Callback HTTP ${response.status}`);
        lastError = statusError;
        // Permanent client errors are not retried.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return { ok: false, error: statusError.message, status: response.status };
        }
      } catch (error) {
        lastError = error;
        if (!isTransient(error, response?.status)) {
          return { ok: false, error: error?.message ?? 'unknown error' };
        }
      }
      if (attempt < backoffMs.length) await sleep(backoffMs[attempt]);
    }
    return { ok: false, error: lastError?.message ?? 'unknown error' };
  }

  return { post };
}
