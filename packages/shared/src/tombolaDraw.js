// Verifiable Tombola draw, algorithm `hmac-sha256-fisher-yates-v1`. Pure: no database, no clock,
// no randomness of its own. The API and the browser run this same code on the same inputs, so
// anybody holding the published data can recompute the winners.
//
//   list      eligible entry numbers, ascending, duplicates removed
//   hash      SHA-256 of the list written as "<entry_number>\n" per entry (the commitment)
//   seed      SHA-256( serverRandom bytes (32) || UTF-8 clientNonce || UTF-8 hash (hex text) ), hex
//   random(i) HMAC-SHA256( key = seed bytes, message = i as 8 bytes big-endian ) read as uint64
//   index     uniform in [0, bound) by rejection sampling of random(counter++), no modulo bias
//   shuffle   partial Fisher–Yates over the list for winners + reserves picks:
//             for i in 0..k-1: j = i + index(n - i); swap(list[i], list[j]); pick list[i]
//   result    picks 1..winners are the winners (rank 1..), the next picks are the reserves in order
//
// Web Crypto (`crypto.subtle`) exists in Node and in browsers, hence the async functions.
import { z } from 'zod';

export const DRAW_ALGORITHM = 'hmac-sha256-fisher-yates-v1';

const encoder = new TextEncoder();
const UINT64 = 1n << 64n;
const subtle = () => globalThis.crypto.subtle;

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (text) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const sha256 = async (bytes) => toHex(await subtle().digest('SHA-256', bytes));

/** Ascending list without duplicates: the same set always gives the same list. */
export const canonicalEntryList = (entryNumbers) =>
  [...new Set(entryNumbers)].sort((a, b) => a - b);

/** The commitment: SHA-256 (hex) of `"<n>\n"` for every entry number, ascending. */
export function entriesHash(entryNumbers) {
  const text = canonicalEntryList(entryNumbers)
    .map((number) => `${number}\n`)
    .join('');
  return sha256(encoder.encode(text));
}

/** `serverRandom` is 32 random bytes as 64 hex characters. */
export function drawSeed({ serverRandom, clientNonce, entriesHash: hash }) {
  return sha256(concat(fromHex(serverRandom), encoder.encode(clientNonce), encoder.encode(hash)));
}

async function randomSource(seed) {
  const key = await subtle().importKey(
    'raw',
    fromHex(seed),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  let counter = 0n;
  const next = async () => {
    const message = new Uint8Array(8);
    new DataView(message.buffer).setBigUint64(0, counter, false);
    counter += 1n;
    const mac = new Uint8Array(await subtle().sign('HMAC', key, message));
    return new DataView(mac.buffer).getBigUint64(0, false);
  };
  return async (bound) => {
    const size = BigInt(bound);
    const limit = UINT64 - (UINT64 % size);
    for (;;) {
      const value = await next();
      if (value < limit) return Number(value % size);
    }
  };
}

/**
 * @param {{ entryNumbers: number[], serverRandom: string, clientNonce: string,
 *   winnersCount: number, reservesCount: number }} input
 * @returns {Promise<{ algorithm: string, seed: string, entriesHash: string, eligibleCount: number,
 *   winners: number[], reserves: number[] }>}
 */
export async function runDraw({
  entryNumbers,
  serverRandom,
  clientNonce,
  winnersCount,
  reservesCount,
}) {
  const list = canonicalEntryList(entryNumbers);
  const hash = await entriesHash(list);
  const seed = await drawSeed({ serverRandom, clientNonce, entriesHash: hash });
  const index = await randomSource(seed);
  const picks = [];
  const wanted = Math.min(list.length, winnersCount + reservesCount);
  for (let i = 0; i < wanted; i++) {
    const j = i + (await index(list.length - i));
    [list[i], list[j]] = [list[j], list[i]];
    picks.push(list[i]);
  }
  return {
    algorithm: DRAW_ALGORITHM,
    seed,
    entriesHash: hash,
    eligibleCount: list.length,
    winners: picks.slice(0, winnersCount),
    reserves: picks.slice(winnersCount),
  };
}

const sameList = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Recomputes a draw from published data and compares it with the published result.
 * @param {{ algorithm: string, entryNumbers: number[], serverRandom: string, clientNonce: string,
 *   winnersCount: number, reservesCount: number, entriesHash?: string, seed?: string,
 *   winners: number[], reserves: number[] }} data
 * @returns {Promise<{ ok: boolean, checks: Record<string, boolean>, computed: object }>}
 */
export async function verifyDraw(data) {
  const computed =
    data.algorithm === DRAW_ALGORITHM
      ? await runDraw(data)
      : { winners: [], reserves: [], entriesHash: null, seed: null };
  const checks = {
    algorithm: data.algorithm === DRAW_ALGORITHM,
    entriesHash: data.entriesHash === undefined || data.entriesHash === computed.entriesHash,
    seed: data.seed === undefined || data.seed === computed.seed,
    winners: sameList(data.winners, computed.winners),
    reserves: sameList(data.reserves, computed.reserves),
  };
  return { ok: Object.values(checks).every(Boolean), checks, computed };
}

// ── Request bodies ───────────────────────────────────────────────────────────────────────────

/** `POST /tombolas/:id/draw`: the client may add its own entropy and names the prizes. */
export const drawInput = z.strictObject({
  clientNonce: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u, 'Printable characters only')
    .optional(),
  prizes: z
    .array(
      z.strictObject({
        rank: z.number().int().min(1).max(1000),
        label: z.string().trim().min(1).max(80),
      }),
    )
    .min(1)
    .max(1000)
    .refine((prizes) => new Set(prizes.map(({ rank }) => rank)).size === prizes.length, {
      message: 'One prize per rank',
    }),
});

export const winnerUnreachableInput = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export const winnerDeliveredInput = z.strictObject({ deliveredAt: z.iso.date().optional() });
