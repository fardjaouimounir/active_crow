import { PgBoss } from 'pg-boss';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { SYSTEM_SCOPE } from '../../core/authz/index.js';
import { tryWithShowcaseLock } from '../../db/showcaseLock.js';

const definitions = new Map();
let boss;
function register(name, handler, options = {}) {
  if (definitions.has(name)) throw new Error('Duplicate job: ' + name);
  definitions.set(name, { handler, options });
}

async function start(connectionString = env.DATABASE_URL) {
  if (boss) return;
  const instance = new PgBoss({ connectionString, schema: 'pgboss' });
  instance.on('error', (err) => logger.error({ err }, 'Job queue failed'));
  await instance.start();
  try {
    for (const [name, { handler, options }] of definitions) {
      const retryLimit = options.retryLimit ?? 3;
      await instance.createQueue(name, { retryLimit, retryDelay: 10, retryBackoff: true });
      await instance.work(name, async ([job]) => {
        const context = {
          scope: SYSTEM_SCOPE,
          retryCount: job.retryCount ?? 0,
          retryLimit,
          logger: logger.child({ jobId: job.id, jobName: name }),
        };
        const run = () => handler(job.data, context);
        if (!options.cron) return run();
        const result = await tryWithShowcaseLock(run, { connectionString });
        if (!result.acquired) context.logger.info('Skipping scheduled job during showcase replay');
        return result.value;
      });
      if (options.cron) await instance.schedule(name, options.cron, {}, { tz: 'Africa/Algiers' });
    }
    boss = instance;
  } catch (err) {
    await instance.stop();
    throw err;
  }
}

async function stop() {
  const instance = boss;
  boss = undefined;
  if (instance) await instance.stop({ graceful: true, timeout: 5000 });
}

function enqueue(name, data, options) {
  if (!boss) throw new Error('Job queue is not running');
  return boss.send(name, data, options);
}

export const jobs = Object.freeze({
  register,
  enqueue,
  start,
  stop,
  isRunning: () => Boolean(boss),
});
