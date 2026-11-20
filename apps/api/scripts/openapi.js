import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { openApiDocument } from '../src/openapi.js';

const output = fileURLToPath(new URL('../openapi.json', import.meta.url));
const config = await resolveConfig(output);
const contents = await format(JSON.stringify(openApiDocument()), { ...config, filepath: output });
writeFileSync(output, contents);
