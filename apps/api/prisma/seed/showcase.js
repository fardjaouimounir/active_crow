// Demo data for «ActiCrew Démo» (see showcaseRun.js for what it builds).
//
//   npm run seed:showcase                      full reset of the demo agency, then a fresh history
//   npm run seed:showcase -- --refresh-today   top up today only (safe to repeat, idempotent per hour)
//   npm run seed:showcase -- --compact         only the last days of each campaign (quick look, tests)
//
// Runs only with DEMO_MODE=true and DEMO_PASSWORD set (apps/api/.env), and refuses a database that
// holds anything that is not demo data. SHOWCASE_NOW=14:30 pretends it is that time of day today.
process.env.LOG_LEVEL ??= 'silent'; // one log line per request is far too much here

const { ShowcaseRefusal, runShowcase } = await import('./showcaseRun.js');
const { buildReport, formatReport } = await import('./showcaseReport.js');
const { disconnectDatabase } = await import('../../src/db/client.js');

const log = (line) => process.stdout.write(line + '\n');
let exitCode = 0;
try {
  const ctx = await runShowcase({
    refreshToday: process.argv.includes('--refresh-today'),
    compact: process.argv.includes('--compact'),
    log,
  });
  log(`\nDone (${ctx.failures.length} call(s) refused — see the lines starting with "!" above).`);
  for (const line of formatReport(await buildReport(ctx))) log(line);
  if (ctx.failures.length) exitCode = 1;
} catch (error) {
  if (error instanceof ShowcaseRefusal) log(`\n${error.message}`);
  else
    process.stderr.write(`${error.stack ?? error}
`);
  exitCode = 1;
} finally {
  await disconnectDatabase();
}
process.exitCode = exitCode;
