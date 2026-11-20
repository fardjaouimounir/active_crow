// Runtime AI configuration. Read from the validated env once; tests replace it with `override`.
// An empty base URL disables the whole module (trigger endpoints answer 503 AI_DISABLED).
import { env } from '../../config/env.js';

const clean = (url) => url?.replace(/\/+$/, '');
const fromEnv = () => ({
  baseUrl: clean(env.AI_SERVICE_BASE_URL),
  inboundKey: env.AI_SERVICE_INBOUND_KEY,
  outboundKey: env.AI_SERVICE_OUTBOUND_KEY,
  timeoutMs: 10_000,
  dailyLimit: 20,
});

let current = fromEnv();

export const aiConfig = Object.freeze({
  get: () => current,
  enabled: () => Boolean(current.baseUrl && current.inboundKey && current.outboundKey),
  /** Test hook: replaces the configuration, returns a function that restores the previous one. */
  override(patch) {
    const previous = current;
    current = { ...fromEnv(), ...patch, baseUrl: clean(patch.baseUrl) };
    return () => {
      current = previous;
    };
  },
});
