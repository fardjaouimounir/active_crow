import { now } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { SYSTEM_SCOPE } from '../../core/authz/index.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';

export async function anonymizeCustomers(_data, { scope, logger }) {
  if (scope !== SYSTEM_SCOPE) throw new Error('Customer maintenance requires system scope');
  const at = now();
  const campaigns = await prisma.$queryRaw`
    SELECT c.id, c.agency_id AS "agencyId"
    FROM campaigns c
    WHERE c.status = 'closed'
      AND (SELECT MAX(h.created_at) FROM campaign_status_history h
           WHERE h.campaign_id = c.id AND h.to_status = 'closed') < ${at}::timestamptz - INTERVAL '6 months'
      AND EXISTS (SELECT 1 FROM customers u WHERE u.campaign_id = c.id AND u.anonymized_at IS NULL)`;
  for (const { id, agencyId } of campaigns) {
    const count = await withTransaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${id}::uuid FOR UPDATE`;
        let total = 0;
        for (;;) {
          const batch = await tx.customer.findMany({
            where: { campaignId: id, agencyId, anonymizedAt: null },
            take: 500,
            select: { id: true },
          });
          if (!batch.length) break;
          const result = await tx.customer.updateMany({
            where: {
              campaignId: id,
              agencyId,
              anonymizedAt: null,
              id: { in: batch.map(({ id }) => id) },
            },
            data: { fullName: null, phone: null, anonymizedAt: at },
          });
          total += result.count;
        }
        if (total)
          await auditService.record(tx, {
            actor: { type: 'system', id: null },
            agencyId,
            action: 'customers.anonymized',
            entityType: 'campaign',
            entityId: id,
            after: { count: total },
          });
        return total;
      },
      { timeoutMs: 120000 },
    );
    logger?.info({ campaignId: id, count }, 'Customer anonymization completed');
  }
}
