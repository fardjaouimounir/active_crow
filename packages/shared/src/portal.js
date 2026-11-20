// Client portal rules shared by the API and the web app.

/** A client user only ever sees campaigns in these statuses (never draft, planning or cancelled). */
export const CLIENT_CAMPAIGN_STATUSES = Object.freeze([
  'assigned',
  'active',
  'suspended',
  'completed',
  'closed',
]);
