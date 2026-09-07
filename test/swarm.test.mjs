import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSwarmHeader, renderSwarmHeader, readSwarmEnabled, stripJsonc, readSwarmModel, treePathForWorkspace } from '../dist/swarm.js';

test('swarm header roundtrip', () => {
  const id = '550e8400-e29b-41d1-a716-446655440000';
  const wire = renderSwarmHeader({ task_id: id, from: 'planner', transfer_send_to: '', attempt: 1 }, '', 'do X\n');
  const m = parseSwarmHeader(wire);
  assert.ok(m);
  assert.equal(m.header.task_id, id);
  assert.equal(m.header.from, 'planner');
  assert.equal(m.header.transfer_send_to, '');
  assert.ok(m.payload.includes('do X'));
});

test('non-swarm body is null', () => {
  assert.equal(parseSwarmHeader('hello'), null);
  assert.equal(parseSwarmHeader('---swarm\ntask_id: nope\n---\nx'), null);
});

test('legacy reply_to header is not a swarm message', () => {
  assert.equal(parseSwarmHeader('---swarm\ntask_id: 550e8400-e29b-41d1-a716-446655440000\nfrom: .\nreply_to: \nattempt: 1\n---\nx\n'), null);
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

test('swarm slot: first task claims, second task ignored, clear resets', async () => {
  const { __swarmSlotForTest } = await import('../dist/swarm-slot.js');
  const seen = [];
  const pi = { sendMessage: (msg, opts) => { seen.push({ text: msg.content, deliverAs: opts?.deliverAs, triggerTurn: opts?.triggerTurn }); } };
  const slot = __swarmSlotForTest();
  const idA = '11111111-2222-4333-8444-555555555555';
  const taskA = `---swarm\ntask_id: ${idA}\nfrom: .\ntransfer_send_to: \nattempt: 1\n---\ndo A\n`;
  const taskB = `---swarm\ntask_id: 22222222-3333-4444-8555-666666666666\nfrom: a\ntransfer_send_to: ${idA}\nattempt: 1\n---\nchild done\n`;
  assert.equal(slot.handle(pi, taskA), 'claimed');
  assert.equal(slot.taskId(), idA);
  // No waiting, no callbacks: a claimed session never accepts another task.
  assert.equal(slot.handle(pi, taskB), 'not-swarm');
  assert.equal(slot.handle(pi, 'plain hello'), 'not-swarm');
  assert.ok(seen.every((m) => m.deliverAs === 'followUp'));
  assert.ok(seen.every((m) => m.triggerTurn === true), 'cold start needs triggerTurn');
  assert.match(seen[0].text, /Onlyne swarm task/);
  slot.clear();
  assert.equal(slot.taskId(), undefined);
});

test('swarm slot: noteSpawned tracks spawned children', async () => {
  const { __swarmSlotForTest } = await import('../dist/swarm-slot.js');
  const pi = { sendMessage: () => {} };
  const slot = __swarmSlotForTest();
  const idA = '11111111-2222-4333-8444-555555555555';
  slot.handle(pi, `---swarm\ntask_id: ${idA}\nfrom: .\ntransfer_send_to: \nattempt: 1\n---\ndo A\n`);
  slot.noteSpawned('child-1');
  slot.noteSpawned('child-2');
  const t = slot.task();
  assert.deepEqual(t.sentChildIds, ['child-1', 'child-2']);
  assert.equal(t.transferSendTo, '');
  slot.clear();
  assert.equal(slot.taskId(), undefined);
});

test('stripJsonc drops comments and trailing commas', () => {
  const src = '{\n  // comment with "quote, and braces }\n  "a": "has // not a comment",\n  "b": [1,2,],\n}';
  const parsed = JSON.parse(stripJsonc(src));
  assert.deepEqual(parsed, { a: 'has // not a comment', b: [1, 2] });
});

test('readSwarmModel parses snapshot triple', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-onlyne-model-'));
  writeFileSync(join(dir, 'swarm.workspace.jsonc'),
    '{\n  // model block\n  "name": "scout",\n  "model": { "provider": "axonhub", "model": "supercheap", "effort": "medium", },\n}');
  assert.deepEqual(readSwarmModel(dir), { provider: 'axonhub', model: 'supercheap', effort: 'medium' });
  writeFileSync(join(dir, 'swarm.workspace.jsonc'), '{"model": {"provider": "", "model": "", "effort": ""}}');
  assert.equal(readSwarmModel(dir), null);
  rmSync(dir, { recursive: true, force: true });
});

test('treePathForWorkspace maps .ws children and root', () => {
  assert.equal(treePathForWorkspace('/r/.ws/model'), 'model');
  assert.equal(treePathForWorkspace('/r/.ws/a/b'), 'a/b');
  assert.equal(treePathForWorkspace('/r'), '.');
  assert.equal(treePathForWorkspace('/r/.ws'), '.');
});
