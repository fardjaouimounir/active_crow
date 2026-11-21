// What the showcase run prints at the end: the accounts (no passwords), the number of rows per entity
// and the findings the dashboards and the AI are expected to surface, with the labels the AI sees
// (S1… for sellers, A1… for Animateurs, PDV-… for stores). Labels come from the real payload builders
// over the real KPIs, so they match what the AI service will receive.
import { buildUserActor } from '../../src/core/auth/actor.js';
import { prisma } from '../../src/db/client.js';
import { animateurCoaching, salesPerformance } from '../../src/modules/ai/aiPayloads.js';
import { reconciliation } from '../../src/modules/inventory/inventory.reports.js';
import { reportingService } from '../../src/modules/reporting/reporting.service.js';
import * as data from './showcaseData.js';
import * as plan from './showcasePlan.js';

const { addDays } = plan;
const pct = (value, digits = 0) =>
  value == null || Number.isNaN(value) ? 'n/a' : `${(value * 100).toFixed(digits)}%`;
const landingOf = (role) =>
  role === 'animateur' ? '/field' : role === 'client' ? '/portal' : '/app';

export async function buildAccounts(ctx) {
  const users = await prisma.user.findMany({
    where: { agencyId: ctx.agency.id },
    select: { email: true, role: true, fullName: true },
  });
  const order = [
    'director',
    'general_manager',
    'regional_manager',
    'supervisor',
    'animateur',
    'client',
  ];
  return users
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.email.localeCompare(b.email))
    .map((user) => ({
      login: user.email,
      role: user.role,
      name: user.fullName,
      landing: landingOf(user.role),
    }));
}

export async function buildCounts(ctx) {
  const where = { agencyId: ctx.agency.id };
  const count = (model, extra = {}) => prisma[model].count({ where: { ...where, ...extra } });
  const byStatus = async (model) =>
    Object.fromEntries(
      (await prisma[model].groupBy({ by: ['status'], where, _count: true })).map((row) => [
        row.status,
        row._count,
      ]),
    );
  const rows = [
    ['users', await count('user')],
    ['regions', await count('region')],
    ['stores', await count('pointOfSale')],
    ['clients', await count('client')],
    ['products', await count('product')],
    ['stock items', await count('stockItem')],
    ['campaigns', await count('campaign')],
    ['assignments', await count('assignment')],
    ['attendance records', await count('attendanceRecord')],
    ['absences', await count('absence')],
    ['supervisor visits', await count('supervisorVisit')],
    ['visit photos', await count('visitPhoto')],
    ['customers', await count('customer')],
    ['sales', await count('sale')],
    ['sale items', await count('saleItem')],
    ['field interactions', await count('fieldInteraction')],
    ['gift entitlements', await count('giftEntitlement')],
    ['stock movements', await count('stockMovement')],
    ['stock ledger entries', await count('stockLedgerEntry')],
    ['tombolas', await count('tombola')],
    ['tombola entries', await count('tombolaEntry')],
    ['tombola winners', await count('tombolaWinner')],
    ['issues', await count('issue')],
    ['announcements', await count('announcement')],
    ['notifications', await count('notification')],
    ['files', await count('file')],
    ['audit log entries', await count('auditLog')],
  ];
  return {
    rows,
    campaigns: await byStatus('campaign'),
    attendance: await byStatus('attendanceRecord'),
  };
}

/**
 * The patterns of the data, measured on the database (so a drifting script shows up here) and named
 * with the labels the AI will see. Returns the lines and a few raw numbers (used by the tests).
 */
export async function buildFindings(ctx) {
  const { org, today } = ctx;
  const najma = ctx.campaigns.find((c) => c.key === 'najma');
  const actor = buildUserActor(org.staff.director);
  const start = addDays(today, najma.startOffset);
  const filters = { campaignIds: [najma.row.id], from: start, to: today };
  const nameOf = new Map(
    Object.entries(org.animateurs).map(([key, user]) => [user.id, plan.SPECS.get(key).name]),
  );
  const storeCode = new Map(Object.values(org.stores).map((s) => [s.id, s.code]));

  const [total, byAnimateur, byDay] = await Promise.all([
    reportingService.aggregates(actor, filters),
    reportingService.aggregates(actor, filters, 'animateur'),
    reportingService.aggregates(actor, filters, 'day'),
  ]);
  const sellers = salesPerformance({ total, animateurs: byAnimateur, daily: byDay });
  const coaching = animateurCoaching({ animateurs: byAnimateur });
  const labelOf = (map) =>
    Object.fromEntries(Object.entries(map).map(([label, id]) => [id, label]));
  const sellerLabel = labelOf(sellers.labelMap);
  const coachLabel = labelOf(coaching.labelMap);
  const who = (id) => `${sellerLabel[id] ?? '?'} / ${coachLabel[id] ?? '?'} (${nameOf.get(id)})`;
  const rowOf = (key) => byAnimateur.find((row) => row.id === org.animateurs[key].id);
  const achievement = (row) => {
    const target = Number(row?.completion?.salesTarget ?? 0);
    return target > 0 ? Number(row.sales.units) / target : null;
  };

  const lines = [];
  const numbers = { total };
  const star = [...plan.SPECS.values()].find((s) => s.story === 'star');
  const weak = [...plan.SPECS.values()].find((s) => s.story === 'weak');
  numbers.star = achievement(rowOf(star.key));
  numbers.weak = achievement(rowOf(weak.key));
  lines.push(
    `Star Animateur: ${who(org.animateurs[star.key].id)} sells ${pct(numbers.star)} of the daily target (top of the ranking).`,
  );
  const lateIds = (
    await prisma.attendanceRecord.findMany({
      where: {
        campaignId: najma.row.id,
        animateurId: org.animateurs[weak.key].id,
        isLate: true,
        checkpoint: 'morning',
        workDate: { gte: new Date(addDays(today, -6)) },
      },
      select: { workDate: true },
    })
  ).length;
  numbers.weakLate = lateIds;
  lines.push(
    `Struggling Animateur: ${who(org.animateurs[weak.key].id)} at ${pct(numbers.weak)} of target (attendance ${pct(rowOf(weak.key)?.attendance.rate)}) with ${lateIds} late check-ins in the last 7 days.`,
  );

  // Weak wilaya: sales per Animateur against the others, and store coverage.
  const wilayaId = plan.KNOBS.weakWilaya.wilayaId;
  const perAnimateur = (ids) =>
    ids.map((id) => Number(byAnimateur.find((r) => r.id === id)?.sales.units ?? 0));
  const idsIn = (inside) =>
    [...plan.SPECS.values()]
      .filter((s) => (s.wilayaId === wilayaId) === inside && org.animateurs[s.key].id)
      .map((s) => org.animateurs[s.key].id);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  numbers.weakWilayaGap = mean(perAnimateur(idsIn(true))) / mean(perAnimateur(idsIn(false))) - 1;
  const assigned = await prisma.assignment.findMany({
    where: { campaignId: najma.row.id, status: 'approved', pointOfSale: { wilayaId } },
    select: { pointOfSaleId: true },
    distinct: ['pointOfSaleId'],
  });
  const visited = await prisma.supervisorVisit.findMany({
    where: {
      campaignId: najma.row.id,
      pointOfSaleId: { in: assigned.map((a) => a.pointOfSaleId) },
    },
    select: { pointOfSaleId: true },
    distinct: ['pointOfSaleId'],
  });
  numbers.weakWilayaCoverage = assigned.length ? visited.length / assigned.length : null;
  const wilaya = await prisma.wilaya.findUnique({ where: { id: wilayaId } });
  lines.push(
    `Weak wilaya: ${wilaya?.nameEn ?? wilayaId} sells ${pct(numbers.weakWilayaGap)} per Animateur vs the other wilayas, supervisor visits cover ${visited.length}/${assigned.length} stores (${pct(numbers.weakWilayaCoverage)}).`,
  );

  // Star store.
  const byStore = await prisma.sale.groupBy({
    by: ['pointOfSaleId'],
    where: { campaignId: najma.row.id, status: 'recorded' },
    _count: true,
    orderBy: { _count: { pointOfSaleId: 'desc' } },
    take: 1,
  });
  numbers.starStore = storeCode.get(byStore[0]?.pointOfSaleId);
  lines.push(
    `Star store: ${numbers.starStore} has the most sales of the campaign (${byStore[0]?._count} sales).`,
  );

  // Growth and Friday dip.
  const days = byDay.filter((d) => d.id).sort((a, b) => a.id.localeCompare(b.id));
  const units = (d) => Number(d.sales.units);
  const firstWeek = mean(
    days
      .slice(0, 7)
      .filter((d) => plan.weekdayOf(d.id) !== 5)
      .map(units),
  );
  const lastWeek = mean(
    days
      .slice(-8, -1)
      .filter((d) => plan.weekdayOf(d.id) !== 5)
      .map(units),
  );
  numbers.growth = lastWeek / firstWeek - 1;
  const fridays = days.filter((d) => plan.weekdayOf(d.id) === 5 && d.id < today).map(units);
  const others = days.filter((d) => plan.weekdayOf(d.id) !== 5 && d.id < today).map(units);
  numbers.fridayDip = mean(fridays) / mean(others) - 1;
  lines.push(
    `Sales trend: ${pct(numbers.growth)} between the first and the last full week; every Friday dips ${pct(numbers.fridayDip)} (${fridays.length} Fridays).`,
  );

  // Supervisor 1 today against the same weekday last week.
  const s1 = org.staff.S1;
  const lastWeekDay = addDays(today, -7);
  const [todayS1, previousS1] = await Promise.all([
    reportingService.aggregates(actor, {
      campaignIds: [najma.row.id],
      supervisorIds: [s1.id],
      from: today,
      to: today,
    }),
    reportingService.aggregates(actor, {
      campaignIds: [najma.row.id],
      supervisorIds: [s1.id],
      from: lastWeekDay,
      to: lastWeekDay,
    }),
  ]);
  numbers.s1Today = Number(todayS1.sales.units) / Math.max(1, Number(previousS1.sales.units)) - 1;
  lines.push(
    `Supervisor 1 (${data.STAFF.S1.name}): today ${todayS1.sales.units} units so far vs ${previousS1.sales.units} on the same weekday last week (${pct(numbers.s1Today)}; +20% planned for a full day, so read it after the evening).`,
  );

  // Attendance.
  numbers.attendance = total.attendance.rate;
  const s4 = await reportingService.aggregates(actor, {
    ...filters,
    supervisorIds: [org.staff.S4.id],
  });
  numbers.s4Attendance = s4.attendance.rate;
  const morningRecords = await prisma.attendanceRecord.count({
    where: { campaignId: najma.row.id, checkpoint: 'morning' },
  });
  const lateRecords = await prisma.attendanceRecord.count({
    where: { campaignId: najma.row.id, checkpoint: 'morning', isLate: true },
  });
  const rejected = await prisma.attendanceRecord.count({
    where: { campaignId: najma.row.id, status: 'rejected' },
  });
  const far = await prisma.attendanceRecord.findMany({
    where: { campaignId: najma.row.id, distanceM: { gt: 150 } },
    select: { animateurId: true, pointOfSaleId: true, distanceM: true, workDate: true },
    orderBy: { distanceM: 'desc' },
  });
  lines.push(
    `Attendance: ${pct(numbers.attendance)} overall; supervisor 4's team (${data.STAFF.S4.name}) ${pct(numbers.s4Attendance)}; ${rejected} rejected proofs; ${lateRecords} late morning check-ins (${pct(lateRecords / Math.max(1, morningRecords))}).`,
  );
  if (far[0])
    lines.push(
      `Far check-in: ${who(far[0].animateurId)} at ${storeCode.get(far[0].pointOfSaleId)} on ${far[0].workDate.toISOString().slice(0, 10)}, ${far[0].distanceM} m from the store.`,
    );
  const leave = await prisma.absence.findFirst({
    where: {
      assignment: { campaignId: najma.row.id },
      type: 'justified',
      workDate: new Date(addDays(today, data.REPLACEMENT.leaveOffset)),
    },
  });
  if (leave)
    lines.push(
      `Justified absence: ${nameOf.get(leave.animateurId)} on ${addDays(today, data.REPLACEMENT.leaveOffset)}, replaced from the next day by ${plan.SPECS.get(data.REPLACEMENT.replacement).name}.`,
    );

  // Stock.
  numbers.giftDistribution = total.gifts.entitledUnits
    ? Number(total.gifts.distributedUnits) / Number(total.gifts.entitledUnits)
    : null;
  const recon = await reconciliation(actor, najma.row.id);
  numbers.reconciled = recon.ok;
  const disputes = await prisma.stockMovement.findMany({
    where: { campaignId: najma.row.id, status: 'disputed' },
    select: {
      id: true,
      lines: { select: { quantity: true, quantityReceived: true } },
      resolvedBy: { select: { id: true } },
    },
  });
  numbers.disputes = disputes.length;
  const undelivered = await prisma.giftEntitlement.aggregate({
    where: { campaignId: najma.row.id, status: 'undelivered' },
    _sum: { quantity: true },
    _count: true,
  });
  numbers.undelivered = undelivered._sum.quantity ?? 0;
  lines.push(
    `Stock: gift distribution ${pct(numbers.giftDistribution)} (${total.gifts.distributedUnits}/${total.gifts.entitledUnits}); ${undelivered._count} undelivered entitlements (${numbers.undelivered} units) since the shortage of the last 3 days; reconciliation ${recon.ok ? 'OK' : 'FAILED'}.`,
  );
  for (const d of disputes)
    lines.push(
      `Stock dispute: transfer of ${d.lines[0]?.quantity} received as ${d.lines[0]?.quantityReceived}, ${d.resolvedBy.length ? 'resolved as a loss' : 'still open'}.`,
    );

  // Customers and Tombola.
  const sales = await prisma.sale.count({
    where: { campaignId: najma.row.id, status: 'recorded' },
  });
  const anonymous = await prisma.sale.count({
    where: { campaignId: najma.row.id, status: 'recorded', customerId: null },
  });
  const customers = await prisma.customer.findMany({
    where: { campaignId: najma.row.id },
    select: { consentTombola: true },
  });
  numbers.anonymous = sales ? anonymous / sales : null;
  numbers.consent = customers.length
    ? customers.filter((c) => c.consentTombola).length / customers.length
    : null;
  lines.push(
    `Customers: ${pct(numbers.anonymous)} anonymous sales, ${pct(numbers.consent)} Tombola consent among ${customers.length} identified customers (fake phones 0555 00xx xx).`,
  );
  for (const campaign of ctx.campaigns.filter((c) => c.tombolaId)) {
    const tombola = await prisma.tombola.findUnique({
      where: { id: campaign.tombolaId },
      select: { status: true, _count: { select: { entries: true } } },
    });
    const winners = await prisma.tombolaWinner.findMany({
      where: { draw: { tombolaId: campaign.tombolaId } },
    });
    const delivered = winners.filter((w) => w.deliveryStatus === 'delivered').length;
    lines.push(
      `Tombola "${campaign.name}": ${tombola.status}, ${tombola._count.entries} entries${winners.length ? `, ${winners.length} winners/reserves (${delivered} prize delivered)` : ''}.`,
    );
  }
  return { lines, numbers };
}

/** Plain text of the three parts. */
export function formatReport({ accounts, counts, findings }) {
  const out = [''];
  out.push('Accounts (every password is DEMO_PASSWORD)');
  const width = Math.max(...accounts.map((a) => a.login.length));
  for (const a of accounts)
    out.push(`  ${a.login.padEnd(width)}  ${a.role.padEnd(17)} ${a.landing.padEnd(8)} ${a.name}`);
  out.push('', 'Rows per entity');
  for (const [label, n] of counts.rows) out.push(`  ${label.padEnd(22)} ${String(n).padStart(7)}`);
  out.push(
    `  campaigns by status    ${Object.entries(counts.campaigns)
      .map(([s, n]) => `${s}=${n}`)
      .join(' ')}`,
    `  attendance by status   ${Object.entries(counts.attendance)
      .map(([s, n]) => `${s}=${n}`)
      .join(' ')}`,
  );
  if (findings) {
    out.push(
      '',
      'Expected AI findings (labels as the AI sees them: S = seller rank, A = Animateur rank, PDV = store)',
    );
    for (const line of findings.lines) out.push(`  • ${line}`);
  }
  return out;
}

export async function buildReport(ctx, { includeFindings = true } = {}) {
  return {
    accounts: await buildAccounts(ctx),
    counts: await buildCounts(ctx),
    findings: includeFindings ? await buildFindings(ctx) : null,
  };
}
