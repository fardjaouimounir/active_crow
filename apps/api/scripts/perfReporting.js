import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import dotenv from 'dotenv';
import pg from 'pg';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

dotenv.config({ path: join(apiDir, '.env'), quiet: true });
if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST is required');
const adminUrl = new URL(process.env.DATABASE_URL_TEST);
if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname))
  throw new Error('The performance fixture requires local PostgreSQL');
adminUrl.pathname = '/postgres';
const dbName = 'fieldflow_perf_' + randomBytes(8).toString('hex');
const perfUrl = new URL(adminUrl);
perfUrl.pathname = '/' + dbName;
const admin = new pg.Client({ connectionString: adminUrl.href });
let created = false;
let prisma;
try {
  await admin.connect();
  await admin.query('CREATE DATABASE ' + dbName);
  created = true;
  execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: perfUrl.href },
    stdio: 'pipe',
  });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL_TEST: perfUrl.href,
    DATABASE_URL: perfUrl.href,
  });
  const database = await import('../src/db/client.js');
  prisma = database.prisma;
  const [{ reportingService }, fixture] = await Promise.all([
    import('../src/modules/reporting/reporting.service.js'),
    import('./reportingFixture.js'),
  ]);
  const { director, regional, campaign, filters } = await fixture.seed(prisma);
  process.stdout.write('Fixture: 50,000 sales, 100,000 attendance records, 5,000 visits\n');
  const scoped = { ...filters, campaignIds: [campaign.id] };
  const tests = [
    ['Director KPIs', () => reportingService.kpis(director, scoped)],
    ['Regional KPIs', () => reportingService.kpis(regional, scoped)],
    ...['day', 'point_of_sale', 'animateur', 'supervisor', 'campaign'].map((dimension) => [
      'Director breakdown ' + dimension,
      () => reportingService.breakdown(director, scoped, dimension),
    ]),
  ];
  for (const [label, run] of tests) {
    const start = performance.now();
    await run();
    process.stdout.write(`${label}: ${Math.round(performance.now() - start)} ms\n`);
  }
  if (process.argv.includes('--explain')) {
    const { aggregate } = await import('../src/modules/reporting/reporting.repository.js');
    const { ScopeService } = await import('../src/core/authz/scopeService.js');
    // This adapter analyzes the exact parameterized statement against the throwaway fixture.
    const analyzer = {
      $queryRaw(strings, ...values) {
        return prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${database.Prisma.sql(strings, ...values)}`;
      },
    };
    const [row] = await aggregate(
      analyzer,
      ScopeService.resolve(director),
      scoped,
      'day',
      new Date(),
    );
    const profile = row['QUERY PLAN'][0];
    const nodes = [];
    const visit = (node) => {
      const children = node.Plans ?? [];
      const inclusive = (item) => item['Actual Total Time'] * item['Actual Loops'];
      const own = Math.max(
        0,
        inclusive(node) - children.reduce((sum, child) => sum + inclusive(child), 0),
      );
      nodes.push([
        node['Subplan Name'] ?? node['Relation Name'] ?? node['Node Type'],
        Math.round(own),
      ]);
      children.forEach(visit);
    };
    visit(profile.Plan);
    const largest = nodes
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, ms]) => `${label} ${ms} ms`);
    process.stdout.write(
      `Day plan: ${Math.round(profile['Execution Time'])} ms; ${largest.join(', ')}\n`,
    );
  }
} finally {
  await prisma?.$disconnect();
  try {
    if (created) await admin.query('DROP DATABASE ' + dbName + ' WITH (FORCE)');
  } finally {
    await admin.end();
  }
}
