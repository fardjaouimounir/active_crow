import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DRAW_ALGORITHM,
  canonicalEntryList,
  drawInput,
  entriesHash,
  runDraw,
  verifyDraw,
} from '../src/index.js';

const SERVER_RANDOM = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

// Fixed vectors: if one of these changes, every published draw would stop verifying.
const VECTORS = [
  {
    entryNumbers: Array.from({ length: 50 }, (_, i) => i + 1),
    serverRandom: SERVER_RANDOM,
    clientNonce: 'ramadan-2026',
    winnersCount: 3,
    reservesCount: 2,
    expected: {
      seed: '79bbcbea3a6f455a164aa4c442348f5d37d0981531d576916c5242fa65ee8e2d',
      entriesHash: '02d36ee22aefffbb3eac4f90f703dd0be636851031144132b43af85384a2afcd',
      winners: [1, 25, 15],
      reserves: [20, 34],
    },
  },
  {
    entryNumbers: [7, 12, 19, 23, 31, 42, 58, 77, 90, 101],
    serverRandom: 'ff'.repeat(32),
    clientNonce: '',
    winnersCount: 2,
    reservesCount: 1,
    expected: {
      seed: '5eec1253c0a070b56d9633a963e4562060705217c696c6c9516766c1d246d099',
      entriesHash: 'df4afa8a40795867e2d4dda8507e679f9de137a9cf867a8df3a073adc23ca2e5',
      winners: [19, 90],
      reserves: [31],
    },
  },
];

/** Independent, synchronous re-implementation of the written specification (node:crypto). */
function reference({ entryNumbers, serverRandom, clientNonce, winnersCount, reservesCount }) {
  const list = [...new Set(entryNumbers)].sort((a, b) => a - b);
  const hash = createHash('sha256')
    .update(list.map((n) => `${n}\n`).join(''))
    .digest('hex');
  const seed = createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(serverRandom, 'hex'),
        Buffer.from(clientNonce),
        Buffer.from(hash),
      ]),
    )
    .digest('hex');
  let counter = 0n;
  const next = () => {
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(counter++);
    return createHmac('sha256', Buffer.from(seed, 'hex'))
      .update(message)
      .digest()
      .readBigUInt64BE(0);
  };
  const index = (bound) => {
    const size = BigInt(bound);
    const limit = 2n ** 64n - (2n ** 64n % size);
    for (;;) {
      const value = next();
      if (value < limit) return Number(value % size);
    }
  };
  const picks = [];
  for (let i = 0; i < Math.min(list.length, winnersCount + reservesCount); i++) {
    const j = i + index(list.length - i);
    [list[i], list[j]] = [list[j], list[i]];
    picks.push(list[i]);
  }
  return {
    seed,
    entriesHash: hash,
    winners: picks.slice(0, winnersCount),
    reserves: picks.slice(winnersCount),
  };
}

describe('hmac-sha256-fisher-yates-v1', () => {
  it.each(VECTORS)('matches the fixed test vector %#', async ({ expected, ...input }) => {
    const result = await runDraw(input);
    expect(result).toMatchObject({ algorithm: DRAW_ALGORITHM, ...expected });
    expect(result.eligibleCount).toBe(input.entryNumbers.length);
    expect(reference(input)).toMatchObject(expected);
  });

  it('is deterministic and independent of the order of the input list', async () => {
    const [{ expected, ...input }] = VECTORS;
    const shuffled = [...input.entryNumbers].reverse().concat(input.entryNumbers.slice(0, 5));
    const again = await runDraw({ ...input, entryNumbers: shuffled });
    expect(again).toMatchObject(expected);
    expect(canonicalEntryList(shuffled)).toEqual(input.entryNumbers);
  });

  it('returns distinct winners and reserves in pick order, never more than the list', async () => {
    const result = await runDraw({
      entryNumbers: [1, 2, 3],
      serverRandom: SERVER_RANDOM,
      clientNonce: 'x',
      winnersCount: 2,
      reservesCount: 5,
    });
    expect(result.winners).toHaveLength(2);
    expect(result.reserves).toHaveLength(1);
    expect(new Set([...result.winners, ...result.reserves]).size).toBe(3);
  });

  it('every input changes the outcome: nonce, server random and list', async () => {
    const [{ expected, ...input }] = VECTORS;
    for (const change of [
      { clientNonce: 'other' },
      { serverRandom: 'aa'.repeat(32) },
      { entryNumbers: input.entryNumbers.slice(1) },
    ]) {
      const result = await runDraw({ ...input, ...change });
      expect(result.seed).not.toBe(expected.seed);
    }
  });

  it('has no visible modulo bias: picks are uniform over many seeds (statistical sanity)', async () => {
    const entryNumbers = [1, 2, 3, 4, 5, 6, 7];
    const counts = new Array(7).fill(0);
    const runs = 1400;
    for (let i = 0; i < runs; i++) {
      const serverRandom = createHash('sha256').update(String(i)).digest('hex');
      const { winners } = await runDraw({
        entryNumbers,
        serverRandom,
        clientNonce: 'bias',
        winnersCount: 1,
        reservesCount: 0,
      });
      counts[winners[0] - 1]++;
    }
    const expected = runs / 7;
    const chiSquare = counts.reduce(
      (sum, observed) => sum + (observed - expected) ** 2 / expected,
      0,
    );
    // 6 degrees of freedom: 22.46 is the 0.1 % critical value, so a fair draw essentially never fails.
    expect(chiSquare).toBeLessThan(22.46);
  }, 30_000);
});

describe('entriesHash and verifyDraw', () => {
  it('the commitment hashes "<n>\\n" per entry and ignores order', async () => {
    const expected = createHash('sha256').update('1\n2\n3\n').digest('hex');
    expect(await entriesHash([3, 1, 2])).toBe(expected);
    expect(await entriesHash([1, 2, 3, 3])).toBe(expected);
  });

  it('verifies real data and rejects tampered data', async () => {
    const [{ expected, ...input }] = VECTORS;
    const published = { ...input, algorithm: DRAW_ALGORITHM, ...expected };
    expect((await verifyDraw(published)).ok).toBe(true);
    const swapped = { ...published, winners: [25, 1, 15] };
    expect(await verifyDraw(swapped)).toMatchObject({ ok: false, checks: { winners: false } });
    const removed = { ...published, entryNumbers: input.entryNumbers.filter((n) => n !== 25) };
    expect((await verifyDraw(removed)).ok).toBe(false);
    expect((await verifyDraw({ ...published, clientNonce: 'forged' })).ok).toBe(false);
    expect((await verifyDraw({ ...published, algorithm: 'other' })).checks.algorithm).toBe(false);
  });
});

describe('drawInput', () => {
  it('accepts a nonce and one prize per rank, rejects the rest', () => {
    const prizes = [{ rank: 1, label: 'TV' }];
    expect(drawInput.safeParse({ prizes }).success).toBe(true);
    expect(drawInput.safeParse({ prizes, clientNonce: 'abc 123' }).success).toBe(true);
    expect(drawInput.safeParse({ prizes, clientNonce: 'x'.repeat(65) }).success).toBe(false);
    expect(drawInput.safeParse({ prizes, clientNonce: 'a\nb' }).success).toBe(false);
    expect(drawInput.safeParse({ prizes: [...prizes, ...prizes] }).success).toBe(false);
    expect(drawInput.safeParse({ prizes: [{ rank: 1, label: 'x'.repeat(81) }] }).success).toBe(
      false,
    );
    expect(drawInput.safeParse({ prizes, extra: 1 }).success).toBe(false);
  });
});
