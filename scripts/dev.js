// Runs the API and the web app in watch mode side by side; when one stops, the other is stopped too.
import { spawn } from 'node:child_process';

const workspaces = ['@fieldflow/api', '@fieldflow/web'];

const children = workspaces.map((workspace) =>
  // A single command string: shell mode is needed on Windows (npm is npm.cmd) and the
  // workspace names are fixed literals, so nothing user-supplied reaches the shell.
  spawn(`npm run dev -w ${workspace}`, { stdio: 'inherit', shell: true }),
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
