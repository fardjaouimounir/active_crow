import { events } from '../../core/events/index.js';
import { jobs } from '../../core/jobs/index.js';
import { withTransaction } from '../../db/transaction.js';
import { notificationService } from './notifications.service.js';

const processors = new Map();
export function subscribe(name, recipients) {
  processors.set(name, recipients);
  events.on(name, (event) =>
    jobs.isRunning() ? jobs.enqueue('notifications.deliver', event) : deliver(event),
  );
}

export function deliver(event) {
  return withTransaction(async (tx) => {
    const details = await processors.get(event.name)?.(tx, event);
    if (!details) return;
    for (const item of [details].flat()) {
      await notificationService.notify(tx, {
        agencyId: event.payload.agencyId,
        actorId: event.payload.actorId,
        type: event.name,
        ...item,
        payload: { ...item.payload, eventId: event.id },
      });
    }
  });
}
