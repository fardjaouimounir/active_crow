// Attaches the Bearer token and recovers from an expired access token with one silent refresh.

/**
 * Endpoints whose 401 a refresh cannot fix (they establish or end the session themselves).
 * Matched against the request path relative to the API base URL.
 */
const NO_RETRY = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

/** @param {string | undefined} url */
const isNoRetry = (url) => NO_RETRY.has((url ?? '').split('?')[0]);
const staleFieldRequest = (config) =>
  config.signal?.aborted || config.fieldSessionCheck?.() === false;

/**
 * @param {import('axios').AxiosInstance} client
 * @param {{
 *   getAccessToken: () => string | null,
 *   refresh: () => Promise<unknown>,
 *   onSessionLost: () => void,
 * }} deps `refresh` must be single-flight (concurrent callers share one call)
 */
export function installAuthInterceptors(client, { getAccessToken, refresh, onSessionLost }) {
  client.interceptors.request.use((config) => {
    if (staleFieldRequest(config)) throw new Error('Request session has ended');
    const token = getAccessToken();
    if (token && !config.headers.has('Authorization')) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error?.config;
      // Retry at most once, and never for the auth endpoints above: no refresh loops.
      if (error?.status !== 401 || !config || config._authRetried || isNoRetry(config.url)) {
        throw error;
      }
      if (staleFieldRequest(config)) throw error;
      try {
        await refresh();
      } catch {
        if (!staleFieldRequest(config)) onSessionLost();
        throw error;
      }
      if (staleFieldRequest(config)) throw error;
      config._authRetried = true;
      config.headers.set('Authorization', `Bearer ${getAccessToken()}`);
      return client.request(config);
    },
  );
}
