// Pure logic for terminal-tab bookkeeping. Keeps add/remove/rename/cycle
// decisions testable in isolation from node-pty, xterm.js, or the DOM.
// Dual-mode: loadable via require() from tests and main, and via <script>
// from the renderer.

(function (global) {
  const MAX_NAME_LEN = 64;

  // Pick the smallest "Terminal N" slot not currently taken by a tab name.
  // Skipping gaps keeps the default numbering compact when tabs are closed.
  function generateDefaultName(tabs) {
    const used = new Set((tabs || []).map((t) => (t && t.name) || ''));
    for (let i = 1; i <= 10000; i++) {
      const candidate = `Terminal ${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return `Terminal ${Date.now()}`;
  }

  function addTab(tabs, tab) {
    return [...(tabs || []), tab];
  }

  // Remove a tab from the list. If the removed tab was active, pick the
  // left neighbor (or the first remaining tab) as the new active.
  function removeTab(tabs, activeId, termId) {
    const list = tabs || [];
    const idx = list.findIndex((t) => t && t.id === termId);
    if (idx === -1) return { tabs: list, activeId };
    const nextTabs = list.filter((_, i) => i !== idx);
    if (activeId !== termId) return { tabs: nextTabs, activeId };
    if (!nextTabs.length) return { tabs: nextTabs, activeId: null };
    const replacementIdx = Math.min(Math.max(0, idx - 1), nextTabs.length - 1);
    return { tabs: nextTabs, activeId: nextTabs[replacementIdx].id };
  }

  function renameTab(tabs, termId, newName) {
    const trimmed = (newName || '').trim().slice(0, MAX_NAME_LEN);
    if (!trimmed) return tabs || [];
    return (tabs || []).map((t) => (t && t.id === termId ? { ...t, name: trimmed } : t));
  }

  // Cycle direction: +1 forward, -1 backward. Returns the new activeId (or null if no tabs).
  function moveActiveIndex(tabs, activeId, direction) {
    const list = tabs || [];
    if (!list.length) return null;
    const dir = direction === -1 ? -1 : 1;
    const currentIdx = list.findIndex((t) => t && t.id === activeId);
    const base = currentIdx === -1 ? 0 : currentIdx;
    const n = list.length;
    const nextIdx = ((base + dir) % n + n) % n;
    return list[nextIdx].id;
  }

  function findTab(tabs, termId) {
    return (tabs || []).find((t) => t && t.id === termId) || null;
  }

  const api = {
    MAX_NAME_LEN,
    generateDefaultName,
    addTab,
    removeTab,
    renameTab,
    moveActiveIndex,
    findTab,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.terminalTabs = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
