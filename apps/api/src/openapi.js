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
  return registry.document();
}
