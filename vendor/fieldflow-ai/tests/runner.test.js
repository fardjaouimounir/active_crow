import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { guardRecordTarget, writeRecording, partialPath, providerErrorCases } from '../eval/run.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('benchmark runner: a measurement can never be silently replaced', () => {
  const never = () => false;
  const always = () => true;

  it('recording needs an explicit --file (the old default was the committed P1 baseline)', () => {
    expect(guardRecordTarget({ mode: 'live', record: true, file: undefined }, never)).toMatch(/explicit --file/);
    expect(guardRecordTarget({ mode: 'live', record: true, file: true }, never)).toMatch(/explicit --file/);
  });

  it('an existing recording is refused unless --force', () => {
    expect(guardRecordTarget({ mode: 'live', record: true, file: 'recorded/x.json' }, always)).toMatch(/refusing to overwrite/);
    expect(guardRecordTarget({ mode: 'live', record: true, file: 'recorded/x.json', force: true }, always)).toBeNull();
    expect(guardRecordTarget({ mode: 'live', record: true, file: 'recorded/new.json' }, never)).toBeNull();
  });

  it('replays and non-recording runs are never blocked', () => {
    expect(guardRecordTarget({ mode: 'recorded', record: true, file: 'recorded/p3.json' }, always)).toBeNull();
    expect(guardRecordTarget({ mode: 'live', record: false, file: 'recorded/p3.json' }, always)).toBeNull();
  });

  it('the real command line refuses before any model call (exit code 2)', () => {
    const noFile = spawnSync(process.execPath, ['eval/run.mjs', '--mode', 'live', '--record'], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    expect(noFile.status).toBe(2);
    expect(noFile.stderr).toMatch(/explicit --file/);
    const existing = spawnSync(process.execPath, ['eval/run.mjs', '--mode', 'live', '--record', '--file', 'recorded/baseline.json'], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    expect(existing.status).toBe(2);
    expect(existing.stderr).toMatch(/refusing to overwrite/);
  });

  it('recordings are written atomically and the partial file name is derived from the target', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-run-'));
    try {
      const file = path.join(dir, 'recorded', 'x.json');
      writeRecording(file, { meta: { claimRules: false }, records: [{ id: 'A' }] });
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).meta.claimRules).toBe(false);
      expect(fs.existsSync(`${file}.tmp`)).toBe(false);
      expect(partialPath('/a/b/x.json')).toBe('/a/b/x.partial.json');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('provider errors are identified, so they are never mistaken for measurements', () => {
    const rec = (reason) => ({ id: 'S', diagnostics: { fallbackReason: reason } });
    const found = providerErrorCases([rec('AI_UNAVAILABLE'), rec('AI_MODEL_TIMEOUT'), rec('AI_RATE_LIMITED'), rec('INVENTED_NUMERALS'), rec(null)]);
    expect(found).toHaveLength(3);
  });
});
