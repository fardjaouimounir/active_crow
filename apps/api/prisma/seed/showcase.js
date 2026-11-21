// Demo data for «ActiCrew Démo» (see showcaseRun.js for what it builds).
//
//   npm run seed:showcase                      full reset of the demo agency, then a fresh history
//   npm run seed:showcase -- --refresh-today   top up today only (safe to repeat, idempotent per hour)
//   npm run seed:showcase -- --compact         only the last days of each campaign (quick look, tests)
//   npm run demo:reset -- --tiny               rebuild a small, fast demo for reviewers
//
// Runs only with DEMO_MODE=true and DEMO_PASSWORD set (apps/api/.env), and refuses a database that
// holds anything that is not demo data. SHOWCASE_NOW=14:30 pretends it is that time of day today.
import { confirmShowcaseReset, parseShowcaseOptions } from './showcaseOptions.js';

process.env.LOG_LEVEL ??= 'silent'; // one log line per request is far too much here

const log = (line) => process.stdout.write(line + '\n');

async function main() {
  const { confirmReset, ...options } = parseShowcaseOptions(process.argv.slice(2));
  if (confirmReset && !(await confirmShowcaseReset())) throw new Error('Showcase reset cancelled.');

  const { ShowcaseRefusal, runShowcase } = await import('./showcaseRun.js');
  const { buildReport, formatReport } = await import('./showcaseReport.js');
  const { disconnectDatabase } = await import('../../src/db/client.js');
  try {
    const ctx = await runShowcase({ ...options, log });
    log(`\nDone (${ctx.failures.length} call(s) refused — see the lines starting with "!" above).`);
    for (const line of formatReport(await buildReport(ctx, { includeFindings: !options.tiny })))
      log(line);
    if (ctx.failures.length) process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof ShowcaseRefusal)) throw error;
    log(`\n${error.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}
