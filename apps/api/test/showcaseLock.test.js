import { describe, expect, it, vi } from 'vitest';
import { runShowcase } from '../prisma/seed/showcaseRun.js';
import { jobs } from '../src/core/jobs/index.js';
import { databaseUrl, prisma } from '../src/db/client.js';
import { tryWithShowcaseLock } from '../src/db/showcaseLock.js';

describe('showcase replay advisory lock', () => {
  it('refuses a full replay before it touches the database when maintenance holds a shared lock', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    try {
      await tryWithShowcaseLock(async () => {
        const before = await prisma.wilaya.count();
        await expect(runShowcase({ tiny: true, password: 'test-only' })).rejects.toThrow(
          /Cannot start a full showcase replay/,
        );
        expect(await prisma.wilaya.count()).toBe(before);
        expect(await prisma.agency.count()).toBe(0);
        await expect(
          runShowcase({ refreshToday: true, tiny: true, password: 'test-only' }),
        ).rejects.toThrow(/Nothing to refresh/);
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('skips a real scheduled worker during replay and runs it after the lock is released', async () => {
    const name = 'showcase-lock-test';
    const handler = vi.fn();
    jobs.register(name, handler, { cron: '0 0 1 1 *' });
    await jobs.start(databaseUrl);
    try {
      await tryWithShowcaseLock(
        async () => {
          const jobId = await jobs.enqueue(name, { attempt: 'during replay' });
          await vi.waitFor(
            async () => {
              const [row] = await prisma.$queryRaw`
            SELECT state::text FROM pgboss.job WHERE id = ${jobId}::uuid AND name = ${name}`;
              expect(row?.state).toBe('completed');
            },
            { timeout: 10_000 },
          );
          expect(handler).not.toHaveBeenCalled();
          expect(await tryWithShowcaseLock(() => {}, { exclusive: true })).toEqual({
            acquired: false,
          });
        },
        { exclusive: true },
      );

      await jobs.enqueue(name, { attempt: 'after replay' });
      await vi.waitFor(
        () =>
          expect(handler).toHaveBeenCalledExactlyOnceWith(
            { attempt: 'after replay' },
            expect.any(Object),
          ),
        { timeout: 10_000 },
      );
    } finally {
      await jobs.stop();
    }
  }, 30_000);

  it('releases the lock when a replay throws', async () => {
    await expect(
      tryWithShowcaseLock(
        () => {
          throw new Error('replay failed');
        },
        { exclusive: true },
      ),
    ).rejects.toThrow('replay failed');
    expect(await tryWithShowcaseLock(() => 'next', { exclusive: true })).toEqual({
      acquired: true,
      value: 'next',
    });
  });
});
