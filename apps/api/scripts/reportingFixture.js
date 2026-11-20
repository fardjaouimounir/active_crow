import {
  createAssignment,
  createFieldContext,
  createProduct,
  createUser,
  day,
} from '../src/db/__tests__/factories.js';

export async function seed(db) {
  const from = '2026-01-01';
  const to = '2026-09-07';
  const ctx = await createFieldContext({ campaign: { startDate: day(from), endDate: day(to) } });
  const {
    agency: { id: agencyId },
    campaign,
    pointOfSale,
    supervisor,
    manager,
    ruleSet,
    client,
  } = ctx;
  const product = await createProduct(agencyId, client.id);
  const agencyDirector = await createUser(agencyId, { role: 'director' });
  await db.reportingLine.create({
    data: {
      agencyId,
      managerId: manager.id,
      userId: supervisor.id,
      validFrom: day(from),
    },
  });
  await db.ruleSet.update({ where: { id: ruleSet.id }, data: { effectiveFrom: day(from) } });
  const codes = ['start', 'midday', 'afternoon', 'end'];
  await db.campaignRule.create({
    data: {
      agencyId,
      ruleSetId: ruleSet.id,
      ruleType: 'attendance',
      config: { checkpoints: codes.map((code) => ({ code })) },
    },
  });
  for (let index = 0; index < 100; index += 1) {
    const animateur = index === 0 ? ctx.animateur : await createUser(agencyId);
    await createAssignment({ ...ctx, animateur }, { startDate: day(from), endDate: day(to) });
  }
  await db.$executeRaw`
    WITH inserted AS (
      INSERT INTO sales (agency_id, campaign_id, assignment_id, point_of_sale_id, animateur_id,
        supervisor_id, rule_set_id, work_date, sold_at)
      SELECT a.agency_id, a.campaign_id, a.id, a.point_of_sale_id, a.animateur_id, a.supervisor_id,
        ${ruleSet.id}::uuid, d::date, d AT TIME ZONE 'Africa/Algiers'
      FROM assignments a
      CROSS JOIN generate_series(${from}::date::timestamp, ${to}::date::timestamp, interval '1 day') d
      CROSS JOIN generate_series(1, 2)
      WHERE a.agency_id = ${agencyId}::uuid AND a.campaign_id = ${campaign.id}::uuid
      RETURNING id, agency_id
    )
    INSERT INTO sale_items(agency_id, sale_id, product_id, quantity)
    SELECT agency_id, id, ${product.id}::uuid, 3 FROM inserted
  `;
  await db.$executeRaw`
    INSERT INTO attendance_records (agency_id, assignment_id, campaign_id, animateur_id,
      point_of_sale_id, work_date, checkpoint, rule_set_id, recorded_at, is_late, status)
    SELECT a.agency_id, a.id, a.campaign_id, a.animateur_id, a.point_of_sale_id, d::date,
      code, ${ruleSet.id}::uuid, d AT TIME ZONE 'Africa/Algiers', false, 'verified'
    FROM assignments a
    CROSS JOIN generate_series(${from}::date::timestamp, ${to}::date::timestamp, interval '1 day') d
    CROSS JOIN (VALUES ('start'), ('midday'), ('afternoon'), ('end')) checkpoints(code)
    WHERE a.agency_id = ${agencyId}::uuid AND a.campaign_id = ${campaign.id}::uuid
  `;
  await db.$executeRaw`
    INSERT INTO supervisor_visits (agency_id, campaign_id, supervisor_id, point_of_sale_id, visited_at, observed_animateur_ids)
    SELECT ${agencyId}::uuid, ${campaign.id}::uuid, ${supervisor.id}::uuid, ${pointOfSale.id}::uuid,
      (d + i * interval '10 minutes') AT TIME ZONE 'Africa/Algiers', ARRAY[]::uuid[]
    FROM generate_series(${from}::date::timestamp, ${to}::date::timestamp, interval '1 day') d
    CROSS JOIN generate_series(1, 20) i
  `;
  await db.$executeRaw`ANALYZE`;
  const actor = (user) => ({ type: 'user', id: user.id, role: user.role, agencyId });
  return {
    campaign,
    director: actor(agencyDirector),
    regional: actor(manager),
    filters: { from, to },
  };
}
