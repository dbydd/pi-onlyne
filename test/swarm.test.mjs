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

test('swarm slot: first task claims, callback routes, foreign task ignored', async () => {
  const { __swarmSlotForTest } = await import('../dist/swarm-slot.js');
  const seen = [];
  const pi = { sendUserMessage: (text, opts) => { seen.push({ text, deliverAs: opts?.deliverAs }); } };
  const slot = __swarmSlotForTest();
  const idA = '11111111-2222-4333-8444-555555555555';
  const idB = '22222222-3333-4444-8555-666666666666';
  const taskA = `---swarm\ntask_id: ${idA}\nfrom: .\nreply_to: \nattempt: 1\n---\ndo A\n`;
  const cbA = `---swarm\ntask_id: ${idB}\nfrom: a\nreply_to: ${idA}\nattempt: 1\n---\nchild done\n`;
  const taskC = `---swarm\ntask_id: 33333333-4444-4555-8666-777777777777\nfrom: .\nreply_to: \nattempt: 1\n---\ndo C\n`;
  assert.equal(slot.handle(pi, taskA), 'claimed');
  assert.equal(slot.taskId(), idA);
  assert.equal(slot.handle(pi, cbA), 'callback');
  assert.equal(slot.handle(pi, taskC), 'busy-ignored');
  assert.equal(slot.handle(pi, 'plain hello'), 'not-swarm');
  assert.ok(seen.every((m) => m.deliverAs === 'followUp'));
  assert.match(seen[0].text, /Onlyne swarm task/);
  assert.match(seen[1].text, /Onlyne swarm callback/);
  assert.match(seen[2].text, /\[onlyne-internal\]/);
});

test('swarm slot: reply_to self counts as callback, clear resets', async () => {
  const { __swarmSlotForTest } = await import('../dist/swarm-slot.js');
  const pi = { sendUserMessage: () => {} };
  const slot = __swarmSlotForTest();
  const idA = '11111111-2222-4333-8444-555555555555';
  slot.handle(pi, `---swarm\ntask_id: ${idA}\nfrom: .\nreply_to: \nattempt: 1\n---\ndo A\n`);
  assert.equal(slot.handle(pi, `---swarm\ntask_id: ${idA}\nfrom: a\nreply_to: \nattempt: 1\n---\nagain\n`), 'callback');
  slot.clear();
  assert.equal(slot.taskId(), undefined);
});
