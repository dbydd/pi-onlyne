import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSwarmHeader, renderSwarmHeader, readSwarmEnabled } from '../dist/swarm.js';

test('swarm header roundtrip', () => {
  const id = '550e8400-e29b-41d1-a716-446655440000';
  const wire = renderSwarmHeader({ task_id: id, from: 'planner', reply_to: '', attempt: 1 }, '', 'do X\n');
  const m = parseSwarmHeader(wire);
  assert.ok(m);
  assert.equal(m.header.task_id, id);
  assert.equal(m.header.from, 'planner');
  assert.ok(m.payload.includes('do X'));
});

test('non-swarm body is null', () => {
  assert.equal(parseSwarmHeader('hello'), null);
  assert.equal(parseSwarmHeader('---swarm\ntask_id: nope\n---\nx'), null);
});

test('swarm flag reads [swarm] enabled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-'));
  try {
    const od = join(dir, '.onlyne');
    mkdirSync(od, { recursive: true });
    assert.equal(readSwarmEnabled(od), false);
    writeFileSync(join(od, 'config.toml'), '[workspace]\nname="x"\n\n[swarm]\nenabled = true\n');
    assert.equal(readSwarmEnabled(od), true);
    writeFileSync(join(od, 'config.toml'), '[workspace]\nname="x"\n\n[swarm]\nenabled = false\n');
    assert.equal(readSwarmEnabled(od), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
