import { registerInventoryOpenApi } from './modules/inventory/inventory.openapi.js';
import { registerAttendanceOpenApi } from './modules/attendance/attendance.openapi.js';
import { registerSalesOpenApi } from './modules/sales/sales.openapi.js';
import { registerNotificationsOpenApi } from './modules/notifications/notifications.openapi.js';
import { registerIssuesOpenApi } from './modules/issues/issues.openapi.js';
import { registerAnnouncementsOpenApi } from './modules/announcements/announcements.openapi.js';
import { createOpenApiRegistry, operation } from './core/http/openapi.js';
import { registerAssignmentsOpenApi } from './modules/assignments/assignments.openapi.js';
import { registerAuthOpenApi } from './modules/auth/auth.openapi.js';
import { registerCampaignsOpenApi } from './modules/campaigns/campaigns.openapi.js';
import { registerRuleSetsOpenApi } from './modules/campaigns/ruleSets.openapi.js';
import { registerCatalogOpenApi } from './modules/catalog/catalog.openapi.js';
import { registerFilesOpenApi } from './modules/files/files.openapi.js';
import { registerOrganizationOpenApi } from './modules/organization/organization.openapi.js';

export function openApiDocument() {
  const registry = createOpenApiRegistry();
  registry.register(
    operation('get', '/health', 'Check service health', undefined, { publicRoute: true }),
  );
  registerAuthOpenApi(registry);
  registerOrganizationOpenApi(registry);
  registerCatalogOpenApi(registry);
  registerFilesOpenApi(registry);
  registerCampaignsOpenApi(registry);
  registerRuleSetsOpenApi(registry);
  registerAssignmentsOpenApi(registry);
  registerInventoryOpenApi(registry);
  registerAttendanceOpenApi(registry);
  registerSalesOpenApi(registry);
  registerNotificationsOpenApi(registry);
  registerIssuesOpenApi(registry);
  registerAnnouncementsOpenApi(registry);
  return registry.document();
}
