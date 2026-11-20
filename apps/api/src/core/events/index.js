import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { eventCatalog } from './catalog.js';

const buffers = new WeakMap();
const handlers = new Map();

export function beginEvents(tx) {
  const batch = [];
  buffers.set(tx, batch);
  return batch;
}

export function publishEvents(batch) {
  for (const event of batch) {
    for (const handler of handlers.get(event.name) ?? []) {
      setImmediate(() => {
        Promise.resolve()
          .then(() => handler(event))
          .catch((err) => {
            logger.error(
              { err, eventId: event.id, eventName: event.name },
              'Event subscriber failed',
            );
          });
      });
    }
  }
}

function emit(tx, name, payload) {
  const schema = eventCatalog[name];
  if (!schema) throw new Error('Unknown event: ' + name);
  const data = env.NODE_ENV === 'production' ? payload : schema.parse(payload);
  const event = { id: data.eventId ?? randomUUID(), name, payload: structuredClone(data) };
  if (!tx) publishEvents([event]);
  else {
    const batch = buffers.get(tx);
    if (!batch) throw new Error('Events require a transaction opened with withTransaction');
    batch.push(event);
  }
  return event.id;
}

function on(name, handler) {
  if (!eventCatalog[name]) throw new Error('Unknown event: ' + name);
  const subscribers = handlers.get(name) ?? new Set();
  subscribers.add(handler);
  handlers.set(name, subscribers);
  return () => subscribers.delete(handler);
}

export const events = Object.freeze({ emit, on });
