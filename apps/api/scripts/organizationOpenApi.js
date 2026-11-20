import { organizationOpenApi } from '../src/modules/organization/organization.openapi.js';

process.stdout.write(JSON.stringify(organizationOpenApi(), null, 2) + '\n');
