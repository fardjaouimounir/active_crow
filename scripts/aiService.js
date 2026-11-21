// Starts the AI service at AI_SERVICE_PATH for local work without touching that repository:
// it loads the service's own .env and listens itself (the service only starts on its own when its
// path has no spaces or special characters, and it does not read .env files).
//
//   npm run ai:start
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dir = resolve(process.env.AI_SERVICE_PATH || 'C:/dev/fieldflow-ai');
if (!existsSync(resolve(dir, 'src/server.js'))) {
  process.stderr.write(`The AI service was not found at ${dir}\n`);
  process.exit(1);
}
process.chdir(dir);
if (existsSync('.env')) process.loadEnvFile('.env');

const { config, assertSecrets } = await import(pathToFileURL(resolve(dir, 'src/config.js')).href);
const { createApp } = await import(pathToFileURL(resolve(dir, 'src/server.js')).href);
assertSecrets();
createApp().listen(config.PORT, () => {
  process.stdout.write(`fieldflow-ai listening on port ${config.PORT}\n`);
});
