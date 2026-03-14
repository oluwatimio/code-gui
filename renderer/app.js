// ===== State =====
const state = {
  conversations: [],
  currentConversationId: null,
  isStreaming: false,
  currentStreamContent: '',
};

// ===== DOM Elements =====
const welcomeEl = document.getElementById('welcome');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const costDisplay = document.getElementById('cost-display');
const newChatBtn = document.getElementById('new-chat-btn');
const conversationList = document.getElementById('conversation-list');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const sidebar = document.getElementById('sidebar');

// ===== Helpers =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  return window.libs.renderMarkdown(text);
}

// ===== Message Rendering =====
function createMessageEl(role, content, isStreaming = false) {
  const msg = document.createElement('div');
  msg.className = `message message-${role}`;

  const header = document.createElement('div');
  header.className = 'message-header';

  const avatar = document.createElement('div');
  avatar.className = `message-avatar avatar-${role}`;

  if (role === 'user') {
    avatar.textContent = 'Y';
  } else if (role === 'assistant') {
    avatar.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor"/>
    </svg>`;
  } else {
    avatar.textContent = '!';
    avatar.style.background = 'var(--error-red)';
    avatar.style.color = 'white';
  }

  const roleLabel = document.createElement('span');
  roleLabel.className = 'message-role';
  roleLabel.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'Claude' : 'Error';

  header.appendChild(avatar);
  header.appendChild(roleLabel);

  const body = document.createElement('div');
  body.className = 'message-body';

  if (content) {
    body.innerHTML = role === 'user' ? escapeHtml(content).replace(/\n/g, '<br>') : renderMarkdown(content);
  }

  if (isStreaming && !content) {
    body.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  }

  if (isStreaming && content) {
    body.classList.add('streaming-cursor');
  }

  msg.appendChild(header);
  msg.appendChild(body);
  return msg;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// ===== Conversation Management =====
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function createConversation(title) {
  const conv = {
    id: generateId(),
    sessionId: generateUUID(),
    title: title || 'New Chat',
    messages: [],
    createdAt: Date.now(),
  };
  state.conversations.unshift(conv);
  state.currentConversationId = conv.id;
  saveState();
  renderConversationList();
  return conv;
}

function getCurrentConversation() {
  return state.conversations.find(c => c.id === state.currentConversationId);
}

function switchConversation(id) {
  state.currentConversationId = id;
  const conv = getCurrentConversation();
  if (!conv) return;

  // Re-render messages
  messagesEl.innerHTML = '';
  for (const msg of conv.messages) {
    messagesEl.appendChild(createMessageEl(msg.role, msg.content));
  }

  if (conv.messages.length > 0) {
    welcomeEl.classList.add('hidden');
    messagesEl.classList.remove('hidden');
    scrollToBottom();
  } else {
    welcomeEl.classList.remove('hidden');
    messagesEl.classList.add('hidden');
  }

  renderConversationList();
  saveState();
}

function deleteConversation(id) {
  state.conversations = state.conversations.filter(c => c.id !== id);
  if (state.currentConversationId === id) {
    if (state.conversations.length > 0) {
      switchConversation(state.conversations[0].id);
    } else {
      state.currentConversationId = null;
      newChat();
    }
  }
  saveState();
  renderConversationList();
}

function renderConversationList() {
  conversationList.innerHTML = '';
  for (const conv of state.conversations) {
    const item = document.createElement('div');
    item.className = `conversation-item ${conv.id === state.currentConversationId ? 'active' : ''}`;
    item.textContent = conv.title;
    item.title = conv.title;

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/>
    </svg>`;
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    };

    item.appendChild(delBtn);
    item.onclick = () => switchConversation(conv.id);
    conversationList.appendChild(item);
  }
}

function newChat() {
  state.currentConversationId = null;
  messagesEl.innerHTML = '';
  messagesEl.classList.add('hidden');
  welcomeEl.classList.remove('hidden');
  inputEl.value = '';
  autoResize();
  renderConversationList();
  inputEl.focus();
}

// ===== Persistence =====
function saveState() {
  try {
    localStorage.setItem('claude-gui-state', JSON.stringify({
      conversations: state.conversations,
      currentConversationId: state.currentConversationId,
    }));
  } catch (e) {
    // Silently fail on storage quota
  }
}

function loadState() {
  try {
    const saved = localStorage.getItem('claude-gui-state');
    if (saved) {
      const data = JSON.parse(saved);
      state.conversations = data.conversations || [];
      state.currentConversationId = data.currentConversationId;
    }
  } catch (e) {
    // Start fresh
  }
}

// ===== Streaming Integration =====
let currentAssistantEl = null;
let streamThrottleTimer = null;

function sendMessage(prompt) {
  if (!prompt.trim() || state.isStreaming) return;

  // Ensure conversation exists
  let conv = getCurrentConversation();
  if (!conv) {
    const title = prompt.slice(0, 50) + (prompt.length > 50 ? '...' : '');
    conv = createConversation(title);
  }

  // Show messages area
  welcomeEl.classList.add('hidden');
  messagesEl.classList.remove('hidden');

  // Add user message
  conv.messages.push({ role: 'user', content: prompt });
  messagesEl.appendChild(createMessageEl('user', prompt));
  scrollToBottom();
  saveState();

  // Create assistant placeholder
  state.isStreaming = true;
  state.currentStreamContent = '';
  currentAssistantEl = createMessageEl('assistant', '', true);
  messagesEl.appendChild(currentAssistantEl);
  scrollToBottom();

  // Update UI
  inputEl.value = '';
  autoResize();
  inputEl.disabled = true;
  sendBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  setStatus('streaming', 'Thinking...');

  // Send to Claude with session context
  const isFirstMessage = conv.messages.length === 1; // just the user message we added
  window.claude.sendPrompt(prompt, conv.sessionId, isFirstMessage);
}

function handleDelta(data) {
  if (!data.text) return;
  state.currentStreamContent += data.text;

  // Throttle re-renders to avoid jank
  if (!streamThrottleTimer) {
    streamThrottleTimer = setTimeout(() => {
      streamThrottleTimer = null;
      if (currentAssistantEl) {
        const body = currentAssistantEl.querySelector('.message-body');
        body.innerHTML = renderMarkdown(state.currentStreamContent);
        body.classList.add('streaming-cursor');
        scrollToBottom();
      }
    }, 30);
  }
  setStatus('streaming', 'Generating...');
}

function handleStreamEnd(data) {
  state.isStreaming = false;

  // Final render
  if (currentAssistantEl) {
    const body = currentAssistantEl.querySelector('.message-body');
    body.innerHTML = renderMarkdown(state.currentStreamContent);
    body.classList.remove('streaming-cursor');
  }

  // Save assistant message
  const conv = getCurrentConversation();
  if (conv) {
    conv.messages.push({ role: 'assistant', content: state.currentStreamContent });
    saveState();
  }

  // Update UI
  currentAssistantEl = null;
  inputEl.disabled = false;
  sendBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  inputEl.focus();

  // Show cost
  if (data && data.cost != null) {
    const costStr = `$${data.cost.toFixed(4)}`;
    const durationStr = data.duration ? `${(data.duration / 1000).toFixed(1)}s` : '';
    const modelStr = data.model || '';
    const parts = [costStr, durationStr, modelStr].filter(Boolean);
    costDisplay.textContent = parts.join(' | ');
  }

  setStatus('ready', 'Ready');
}

function handleStreamError(error) {
  state.isStreaming = false;

  // Show error message
  if (currentAssistantEl) {
    currentAssistantEl.remove();
  }
  messagesEl.appendChild(createMessageEl('error', `Error: ${error}`));
  scrollToBottom();

  currentAssistantEl = null;
  inputEl.disabled = false;
  sendBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  inputEl.focus();
  setStatus('error', 'Error occurred');
}

function handleStreamClose(data) {
  // If we haven't received a proper end event, finalize
  if (state.isStreaming) {
    handleStreamEnd({});
  }
}

function stopGeneration() {
  window.claude.stopGeneration();
  state.isStreaming = false;

  if (currentAssistantEl) {
    const body = currentAssistantEl.querySelector('.message-body');
    if (state.currentStreamContent) {
      body.innerHTML = renderMarkdown(state.currentStreamContent);
    } else {
      body.innerHTML = '<em style="color:var(--text-muted)">Generation stopped</em>';
    }
    body.classList.remove('streaming-cursor');
  }

  const conv = getCurrentConversation();
  if (conv && state.currentStreamContent) {
    conv.messages.push({ role: 'assistant', content: state.currentStreamContent });
    saveState();
  }

  currentAssistantEl = null;
  inputEl.disabled = false;
  sendBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  inputEl.focus();
  setStatus('ready', 'Stopped');
}

// ===== Status =====
function setStatus(type, text) {
  const dotClass = type === 'streaming' ? 'streaming' : type === 'error' ? 'error' : 'ready';
  statusText.innerHTML = `<span class="status-dot ${dotClass}"></span> ${text}`;
}

// ===== Auto-resize textarea =====
function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
}

// ===== Copy code handler =====
function handleCopyClick(e) {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;

  const code = btn.getAttribute('data-code');
  if (!code) return;

  // Decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = code;
  const decoded = textarea.value;

  navigator.clipboard.writeText(decoded).then(() => {
    const label = btn.querySelector('span');
    const origText = label.textContent;
    label.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      label.textContent = origText;
      btn.classList.remove('copied');
    }, 2000);
  });
}

// ===== External link handler =====
function handleLinkClick(e) {
  const link = e.target.closest('a');
  if (link && link.href && link.href.startsWith('http')) {
    e.preventDefault();
    window.shellAPI.openExternal(link.href);
  }
}

// ===== Permission Dialog =====
const permOverlay = document.getElementById('permission-overlay');
const permToolName = document.getElementById('perm-tool-name');
const permInputDisplay = document.getElementById('perm-input-display');
const permAllowBtn = document.getElementById('perm-allow');
const permDenyBtn = document.getElementById('perm-deny');

function showPermissionDialog(data) {
  permToolName.textContent = data.toolName;

  // Format the tool input for display
  let displayText = '';
  const input = data.input || {};
  if (data.toolName === 'Bash' && input.command) {
    displayText = `$ ${input.command}`;
  } else if (data.toolName === 'Write' && input.file_path) {
    displayText = `File: ${input.file_path}\n\n${(input.content || '').slice(0, 500)}${(input.content || '').length > 500 ? '\n...' : ''}`;
  } else if (data.toolName === 'Edit' && input.file_path) {
    displayText = `File: ${input.file_path}\n\nOld: ${input.old_string || ''}\nNew: ${input.new_string || ''}`;
  } else if (data.toolName === 'Read' && input.file_path) {
    displayText = `File: ${input.file_path}`;
  } else {
    displayText = JSON.stringify(input, null, 2);
  }
  permInputDisplay.textContent = displayText;

  permOverlay.classList.remove('hidden');
  permAllowBtn.focus();
}

function hidePermissionDialog() {
  permOverlay.classList.add('hidden');
}

// ===== Memory Panel =====
const memoryList = document.getElementById('memory-list');
const memoryEmpty = document.getElementById('memory-empty');
const memorySearch = document.getElementById('memory-search');
let memorySearchTimeout = null;

async function loadMemories(query) {
  memoryList.innerHTML = '<div class="memory-loading"><span class="status-dot streaming"></span> Loading...</div>';
  memoryEmpty.classList.add('hidden');

  try {
    let memories;
    if (query && query.trim()) {
      memories = await window.brain.search(query.trim());
    } else {
      memories = await window.brain.list();
    }

    memoryList.innerHTML = '';
    if (memories.length === 0) {
      memoryEmpty.classList.remove('hidden');
      return;
    }

    for (const mem of memories) {
      memoryList.appendChild(createMemoryCard(mem));
    }
  } catch (e) {
    memoryList.innerHTML = '';
    memoryEmpty.classList.remove('hidden');
    memoryEmpty.querySelector('p').textContent = 'Could not connect to Brain';
  }
}

function createMemoryCard(mem) {
  const card = document.createElement('div');
  card.className = 'memory-card';

  const content = document.createElement('div');
  content.className = 'memory-content';
  content.textContent = mem.content;

  const meta = document.createElement('div');
  meta.className = 'memory-meta';

  if (mem.category) {
    const cat = document.createElement('span');
    cat.className = 'memory-category';
    cat.textContent = mem.category;
    meta.appendChild(cat);
  }

  if (mem.tags && mem.tags.length) {
    for (const tag of mem.tags.slice(0, 3)) {
      const t = document.createElement('span');
      t.className = 'memory-tag';
      t.textContent = tag;
      meta.appendChild(t);
    }
  }

  const date = document.createElement('span');
  date.className = 'memory-date';
  date.textContent = new Date(mem.createdAt).toLocaleDateString();
  meta.appendChild(date);

  const delBtn = document.createElement('button');
  delBtn.className = 'memory-delete';
  delBtn.title = 'Delete memory';
  delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>';
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    await window.brain.delete(mem.id);
    card.remove();
    if (memoryList.children.length === 0) {
      memoryEmpty.classList.remove('hidden');
    }
  };

  card.appendChild(content);
  card.appendChild(meta);
  card.appendChild(delBtn);
  return card;
}

// ===== Event Listeners =====
function init() {
  // Load state
  loadState();
  if (state.currentConversationId) {
    switchConversation(state.currentConversationId);
  }
  renderConversationList();

  // IPC listeners
  window.claude.onStreamStart(() => {
    setStatus('streaming', 'Connected...');
  });
  window.claude.onStreamDelta(handleDelta);
  window.claude.onStreamEnd(handleStreamEnd);
  window.claude.onStreamError(handleStreamError);
  window.claude.onStreamClose(handleStreamClose);

  // Permission dialog
  let currentPermissionData = null;

  window.claude.onPermissionRequest((data) => {
    currentPermissionData = data;
    showPermissionDialog(data);
    setStatus('streaming', 'Waiting for approval...');
  });

  permAllowBtn.addEventListener('click', () => {
    // Allow: pass back the original input as updatedInput
    window.claude.respondPermission({ updatedInput: currentPermissionData?.input || {} });
    currentPermissionData = null;
    hidePermissionDialog();
    setStatus('streaming', 'Generating...');
  });

  permDenyBtn.addEventListener('click', () => {
    window.claude.respondPermission({ behavior: 'deny', message: 'User denied permission' });
    currentPermissionData = null;
    hidePermissionDialog();
    setStatus('streaming', 'Generating...');
  });

  // Input
  inputEl.addEventListener('input', autoResize);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  // Buttons
  sendBtn.addEventListener('click', () => sendMessage(inputEl.value));
  stopBtn.addEventListener('click', stopGeneration);
  newChatBtn.addEventListener('click', newChat);

  // Sidebar toggle
  toggleSidebarBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // Suggestion chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt) {
        sendMessage(prompt);
      }
    });
  });

  // Copy code blocks (event delegation)
  messagesEl.addEventListener('click', handleCopyClick);

  // External links
  messagesEl.addEventListener('click', handleLinkClick);

  // Titlebar
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  document.getElementById('btn-minimize').addEventListener('click', () => window.windowControls.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.windowControls.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.windowControls.close());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+N: New chat
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      newChat();
    }
    // Escape: Stop generation
    if (e.key === 'Escape' && state.isStreaming) {
      stopGeneration();
    }
    // Ctrl+B: Toggle sidebar
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      sidebar.classList.toggle('collapsed');
    }
  });

  // Maximize state
  window.windowControls.onMaximized((isMaximized) => {
    const btn = document.getElementById('btn-maximize');
    btn.title = isMaximized ? 'Restore' : 'Maximize';
  });

  // Sidebar tabs
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

      if (tab.dataset.tab === 'memories') {
        loadMemories();
      }
    });
  });

  // Memory search
  memorySearch.addEventListener('input', () => {
    clearTimeout(memorySearchTimeout);
    memorySearchTimeout = setTimeout(() => {
      loadMemories(memorySearch.value);
    }, 300);
  });

  // Initial status
  setStatus('ready', 'Ready');
  inputEl.focus();
}

init();
