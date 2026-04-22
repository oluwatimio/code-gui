const { test } = require('node:test');
const assert = require('node:assert/strict');

const tt = require('../lib/terminal-tabs');

// ===== generateDefaultName =====

test('generateDefaultName: empty list returns Terminal 1', () => {
  assert.equal(tt.generateDefaultName([]), 'Terminal 1');
  assert.equal(tt.generateDefaultName(null), 'Terminal 1');
  assert.equal(tt.generateDefaultName(undefined), 'Terminal 1');
});

test('generateDefaultName: picks the smallest free slot', () => {
  assert.equal(tt.generateDefaultName([{ id: 'a', name: 'Terminal 1' }]), 'Terminal 2');
  assert.equal(
    tt.generateDefaultName([
      { id: 'a', name: 'Terminal 1' },
      { id: 'b', name: 'Terminal 2' },
    ]),
    'Terminal 3'
  );
});

test('generateDefaultName: fills gaps when a slot is reopened', () => {
  const tabs = [
    { id: 'a', name: 'Terminal 1' },
    { id: 'c', name: 'Terminal 3' },
  ];
  assert.equal(tt.generateDefaultName(tabs), 'Terminal 2');
});

test('generateDefaultName: renamed tabs do not block numeric slots', () => {
  const tabs = [
    { id: 'a', name: 'Build server' },
    { id: 'b', name: 'Terminal 2' },
  ];
  assert.equal(tt.generateDefaultName(tabs), 'Terminal 1');
});

// ===== addTab =====

test('addTab: appends without mutating the source array', () => {
  const before = [{ id: 'a', name: 'A' }];
  const after = tt.addTab(before, { id: 'b', name: 'B' });
  assert.equal(after.length, 2);
  assert.equal(after[1].id, 'b');
  assert.equal(before.length, 1);
});

test('addTab: accepts null/undefined source', () => {
  assert.deepEqual(tt.addTab(null, { id: 'a', name: 'A' }), [{ id: 'a', name: 'A' }]);
  assert.deepEqual(tt.addTab(undefined, { id: 'a', name: 'A' }), [{ id: 'a', name: 'A' }]);
});

// ===== removeTab =====

test('removeTab: removing a non-active tab keeps active unchanged', () => {
  const tabs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const result = tt.removeTab(tabs, 'a', 'b');
  assert.deepEqual(result.tabs.map((t) => t.id), ['a']);
  assert.equal(result.activeId, 'a');
});

test('removeTab: removing the active middle tab picks the left neighbor', () => {
  const tabs = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];
  const result = tt.removeTab(tabs, 'b', 'b');
  assert.deepEqual(result.tabs.map((t) => t.id), ['a', 'c']);
  assert.equal(result.activeId, 'a');
});

test('removeTab: removing the leftmost active tab picks the new leftmost', () => {
  const tabs = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  const result = tt.removeTab(tabs, 'a', 'a');
  assert.deepEqual(result.tabs.map((t) => t.id), ['b']);
  assert.equal(result.activeId, 'b');
});

test('removeTab: removing the last remaining tab clears activeId', () => {
  const tabs = [{ id: 'a', name: 'A' }];
  const result = tt.removeTab(tabs, 'a', 'a');
  assert.deepEqual(result.tabs, []);
  assert.equal(result.activeId, null);
});

test('removeTab: removing a non-existent id is a no-op', () => {
  const tabs = [{ id: 'a', name: 'A' }];
  const result = tt.removeTab(tabs, 'a', 'zzz');
  assert.deepEqual(result.tabs, tabs);
  assert.equal(result.activeId, 'a');
});

test('removeTab: handles null tabs defensively', () => {
  const result = tt.removeTab(null, null, 'x');
  assert.deepEqual(result.tabs, []);
  assert.equal(result.activeId, null);
});

// ===== renameTab =====

test('renameTab: trims whitespace and updates', () => {
  const tabs = [{ id: 'a', name: 'A' }];
  const out = tt.renameTab(tabs, 'a', '  Build  ');
  assert.equal(out[0].name, 'Build');
});

test('renameTab: empty/whitespace-only input leaves name unchanged', () => {
  const tabs = [{ id: 'a', name: 'A' }];
  assert.equal(tt.renameTab(tabs, 'a', '')[0].name, 'A');
  assert.equal(tt.renameTab(tabs, 'a', '   ')[0].name, 'A');
});

test('renameTab: clamps to MAX_NAME_LEN', () => {
  const tabs = [{ id: 'a', name: 'A' }];
  const long = 'x'.repeat(tt.MAX_NAME_LEN + 50);
  const out = tt.renameTab(tabs, 'a', long);
  assert.equal(out[0].name.length, tt.MAX_NAME_LEN);
});

test('renameTab: non-existent id returns tabs unchanged', () => {
  const tabs = [{ id: 'a', name: 'A' }];
  const out = tt.renameTab(tabs, 'zzz', 'Hello');
  assert.deepEqual(out, tabs);
});

test('renameTab: does not mutate the source array', () => {
  const tabs = [{ id: 'a', name: 'A' }];
  tt.renameTab(tabs, 'a', 'New');
  assert.equal(tabs[0].name, 'A');
});

// ===== moveActiveIndex =====

test('moveActiveIndex: forward cycles and wraps around', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(tt.moveActiveIndex(tabs, 'a', 1), 'b');
  assert.equal(tt.moveActiveIndex(tabs, 'b', 1), 'c');
  assert.equal(tt.moveActiveIndex(tabs, 'c', 1), 'a');
});

test('moveActiveIndex: backward cycles and wraps around', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(tt.moveActiveIndex(tabs, 'a', -1), 'c');
  assert.equal(tt.moveActiveIndex(tabs, 'b', -1), 'a');
});

test('moveActiveIndex: empty list returns null', () => {
  assert.equal(tt.moveActiveIndex([], null, 1), null);
  assert.equal(tt.moveActiveIndex(null, null, 1), null);
});

test('moveActiveIndex: unknown active falls back to first', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }];
  // Unknown current → treated as index 0, so forward goes to 'b'
  assert.equal(tt.moveActiveIndex(tabs, 'zzz', 1), 'b');
});

// ===== findTab =====

test('findTab: returns the tab or null', () => {
  const tabs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  assert.deepEqual(tt.findTab(tabs, 'b'), { id: 'b', name: 'B' });
  assert.equal(tt.findTab(tabs, 'zzz'), null);
  assert.equal(tt.findTab(null, 'a'), null);
});
