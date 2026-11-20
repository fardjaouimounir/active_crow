// Recomputes a Tombola draw from the data published by GET /tombolas/:id/draw/verification
// (the portal "Download draw data" button saves the same JSON) and prints the winners.
//
//   npm run tombola:verify -- draw.json [committed-entries-hash]
//
// With the commitment hash shown in the portal before the draw, the script also checks that the
// published entry list is the committed one.
import { readFileSync } from 'node:fs';
import { verifyDraw } from '@fieldflow/shared';

const file = process.argv[2];
if (!file) {
  process.stderr.write('Usage: npm run tombola:verify -- <draw.json>\n');
  process.exit(2);
}

const data = JSON.parse(readFileSync(file, 'utf8'));
const { ok: recomputed, checks, computed } = await verifyDraw(data);
const committed = process.argv[3];
if (committed) checks.commitment = committed === computed.entriesHash;
const ok = recomputed && Object.values(checks).every(Boolean);
const line = (label, numbers) => `${label}: ${numbers.join(', ') || '-'}`;
process.stdout.write(
  [
    `Algorithm: ${data.algorithm}`,
    `Eligible entries: ${data.entryNumbers.length}`,
    `Commitment (entries hash): ${computed.entriesHash}`,
    `Seed: ${computed.seed}`,
    line('Winners (rank order)', computed.winners),
    line('Reserves (in order)', computed.reserves),
    ...Object.entries(checks).map(([name, passed]) => `${passed ? '✓' : '✗'} ${name}`),
    ok ? '✓ The published draw matches the recomputed one.' : '✗ MISMATCH with the published draw.',
    '',
  ].join('\n'),
);
process.exit(ok ? 0 : 1);
