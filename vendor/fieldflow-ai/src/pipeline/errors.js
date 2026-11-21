// Classifies provider-call failures. Parsing and validation failures are
// classified separately (see parse.js and pipeline/index.js); nothing here
// defaults to "timeout" any more.

export function classifyProviderError(error) {
  const status = Number(error?.status ?? error?.response?.status);
  const name = String(error?.name ?? '');
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();

  if (/timeout/i.test(name) || /timed? ?out|timeout|etimedout/i.test(`${message} ${code}`)) return 'AI_MODEL_TIMEOUT';
  if (status === 429 || /\b429\b|rate.?limit/.test(message)) return 'AI_RATE_LIMITED';
  if (status === 401 || status === 403 || /\b40[13]\b|unauthori[sz]ed|forbidden|invalid api key|incorrect api key/.test(message)) {
    return 'AI_AUTH_FAILED';
  }
  if (status === 404 || /\b404\b|model.*(not found|does not exist)/.test(message)) return 'AI_MODEL_NOT_FOUND';
  if (status === 400 || status === 422 || /\b(400|422)\b|unsupported parameter|invalid request/.test(message)) {
    return 'AI_BAD_REQUEST';
  }
  if (
    status >= 500 ||
    /apiconnection/i.test(name) ||
    /econnrefused|enotfound|econnreset|connection error|fetch failed|network|unavailable|\b5\d\d\b|provider down/.test(`${message} ${code}`)
  ) {
    return 'AI_UNAVAILABLE';
  }
  return 'AI_PROVIDER_ERROR';
}
