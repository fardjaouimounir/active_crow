import { createInterface } from 'node:readline';

const FLAGS = new Set(['--refresh-today', '--compact', '--tiny', '--confirm-reset']);

export function parseShowcaseOptions(args) {
  for (const arg of args) {
    if (!FLAGS.has(arg)) throw new Error(`Unknown showcase argument: ${arg}`);
  }
  const refreshToday = args.includes('--refresh-today');
  const confirmReset = args.includes('--confirm-reset');
  if (refreshToday && confirmReset) throw new Error('Choose either a reset or a today refresh.');
  return {
    refreshToday,
    confirmReset,
    compact: args.includes('--compact'),
    tiny: args.includes('--tiny'),
  };
}

export async function confirmShowcaseReset() {
  process.stdout.write('This replaces the showcase data. Type RESET to continue: ');
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const answer of lines) return answer === 'RESET';
    return false;
  } finally {
    lines.close();
  }
}
