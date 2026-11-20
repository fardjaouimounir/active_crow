import { cleanupTokens } from '../../modules/auth/tokenMaintenance.js';
import { autoVerify } from '../../modules/attendance/attendance.service.js';
import { closeExpired } from '../../modules/sales/tombola.service.js';
import { anonymizeCustomers } from '../../modules/customers/anonymization.js';
import { notificationService } from '../../modules/notifications/notifications.service.js';
import { deliver } from '../../modules/notifications/subscriptions.js';
import { cleanupIdempotencyKeys } from '../http/idempotency.js';
import '../../modules/ai/ai.jobs.js';
import { jobs } from './index.js';

jobs.register('auth.cleanup-tokens', cleanupTokens, { cron: '30 2 * * *' });
jobs.register('customers.anonymize', anonymizeCustomers, { cron: '0 3 * * *' });
jobs.register('notifications.cleanup', notificationService.cleanup, { cron: '0 4 * * *' });
jobs.register('notifications.deliver', deliver);
jobs.register('idempotency.cleanup', cleanupIdempotencyKeys, { cron: '15 4 * * *' });
jobs.register('attendance.auto-verify', autoVerify, { cron: '*/30 * * * *' });
jobs.register('tombola.close-expired', closeExpired, { cron: '*/15 * * * *' });
