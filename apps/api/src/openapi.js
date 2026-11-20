import { createOpenApiRegistry, operation } from './core/http/openapi.js';
import { registerAuthOpenApi } from './modules/auth/auth.openapi.js';
import { registerOrganizationOpenApi } from './modules/organization/organization.openapi.js';

export function openApiDocument() {
  const registry = createOpenApiRegistry();
  registry.register(
    operation('get', '/health', 'Check service health', undefined, { publicRoute: true }),
  );
  registerAuthOpenApi(registry);
  registerOrganizationOpenApi(registry);
  return registry.document();
}
