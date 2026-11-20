// pg-boss queues of the AI module: one per capability (retryLimit 5, exponential backoff) and the
// daily scheduler. Job data is `{ aiRequestId }` only.
import { AI_CAPABILITIES } from '@fieldflow/shared';
import { jobs } from '../../core/jobs/index.js';
import { aiService } from './ai.service.js';

for (const capability of AI_CAPABILITIES) {
  jobs.register(`ai.${capability}`, aiService.processRequest, { retryLimit: 5 });
}
jobs.register('ai.schedule-daily-summaries', aiService.scheduleDailySummaries, {
  cron: '30 19 * * *',
});
