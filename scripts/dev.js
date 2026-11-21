// Runs the API and the web app side by side; when one stops, the other is stopped too.
import { spawn } from 'node:child_process';

const apiScript = process.argv.includes('--no-api-watch') ? 'start' : 'dev';
const commands = [`npm run ${apiScript} -w @fieldflow/api`, 'npm run dev -w @fieldflow/web'];

const children = commands.map((command) =>
  // A single command string: shell mode is needed on Windows (npm is npm.cmd) and the
  // workspace names are fixed literals, so nothing user-supplied reaches the shell.
  spawn(command, { stdio: 'inherit', shell: true }),
);

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}

for (const child of children) {
  child.on('exit', (code) => stopAll(code ?? 0));
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
