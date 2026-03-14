const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let mainWindow;
let currentProcess = null;
let permissionServer = null;
let permissionPort = null;
let pendingPermission = null;
let mcpConfigPath = null;

const isPacked = app.isPackaged;

// Resolve claude binary - packaged apps may not inherit shell PATH
function findClaudeBinary() {
  const { execSync } = require('child_process');

  // Try common locations
  const candidates = [
    'claude', // in PATH already
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate.startsWith('/') ? candidate : '');
      return candidate;
    } catch (e) {}
  }

  // Fall back to shell lookup
  try {
    return execSync('bash -lc "which claude"', { encoding: 'utf8' }).trim();
  } catch (e) {}

  return 'claude'; // hope for the best
}

// MCP server lives in extraResources when packaged, next to main.js in dev
function getMcpServerPath() {
  if (isPacked) {
    return path.join(process.resourcesPath, 'mcp-permission-server.js');
  }
  return path.join(__dirname, 'mcp-permission-server.js');
}

// Find node binary - Claude spawns MCP servers, so it needs the full path
function findNodeBinary() {
  const { execSync } = require('child_process');

  // Best approach: ask the shell (picks up nvm, fnm, etc.)
  try {
    const result = execSync('bash -lc "which node"', { encoding: 'utf8', timeout: 5000 }).trim();
    if (result) return result;
  } catch (e) {}

  // Check NVM current alias
  const nvmDir = path.join(os.homedir(), '.nvm');
  try {
    const currentLink = fs.realpathSync(path.join(nvmDir, 'current', 'bin', 'node'));
    if (currentLink) return currentLink;
  } catch (e) {}

  // Scan NVM versions for any node binary
  try {
    const versionsDir = path.join(nvmDir, 'versions', 'node');
    const versions = fs.readdirSync(versionsDir).sort().reverse();
    for (const v of versions) {
      const bin = path.join(versionsDir, v, 'bin', 'node');
      try { fs.accessSync(bin, fs.constants.X_OK); return bin; } catch (e) {}
    }
  } catch (e) {}

  // Standard locations
  for (const p of ['/usr/bin/node', '/usr/local/bin/node', path.join(os.homedir(), '.local', 'bin', 'node')]) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) {}
  }

  return 'node';
}

// ===== Permission Bridge HTTP Server =====
function startPermissionServer() {
  return new Promise((resolve) => {
    permissionServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/permission') {
        let body = '';
        req.on('data', (chunk) => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            // Send to renderer for user approval
            pendingPermission = res;
            mainWindow.webContents.send('permission:request', {
              toolName: data.tool_name || 'Unknown',
              input: data.input || {},
              toolUseId: data.tool_use_id || ''
            });
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ behavior: 'deny', reason: 'Bad request' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Listen on random available port
    permissionServer.listen(0, '127.0.0.1', () => {
      permissionPort = permissionServer.address().port;
      resolve(permissionPort);
    });
  });
}

// Handle permission response from renderer
ipcMain.on('permission:response', (_, decision) => {
  if (pendingPermission) {
    pendingPermission.writeHead(200, { 'Content-Type': 'application/json' });
    pendingPermission.end(JSON.stringify(decision));
    pendingPermission = null;
  }
});

// ===== Window =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:maximized', false);
  });
}

app.whenReady().then(async () => {
  await startPermissionServer();
  writeMcpConfig();
  createWindow();
});

function loadBrainConfig() {
  // Try GUI-specific config first, then fall back to Claude CLI settings
  const guiConfig = path.join(os.homedir(), '.config', 'claude-code-gui', 'brain.json');
  try {
    return JSON.parse(fs.readFileSync(guiConfig, 'utf8'));
  } catch (e) {}

  // Fall back to Claude CLI settings
  const cliSettings = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(cliSettings, 'utf8'));
    const brain = settings.mcpServers?.brain;
    if (brain) {
      return {
        brainUrl: brain.env?.BRAIN_URL,
        brainApiKey: brain.env?.BRAIN_API_KEY || '',
        mcpDistPath: brain.args?.[0]
      };
    }
  } catch (e) {}

  return null;
}

function writeMcpConfig() {
  const mcpServerPath = getMcpServerPath();
  const nodeBin = findNodeBinary();
  const config = {
    mcpServers: {
      'gui_permissions': {
        type: 'stdio',
        command: nodeBin,
        args: [mcpServerPath],
        env: {
          CLAUDE_GUI_PERMISSION_PORT: String(permissionPort)
        }
      }
    }
  };

  // Add brain MCP if configured
  const brain = loadBrainConfig();
  if (brain && brain.mcpDistPath && brain.brainUrl) {
    config.mcpServers['brain'] = {
      type: 'stdio',
      command: nodeBin,
      args: [brain.mcpDistPath],
      env: {
        BRAIN_URL: brain.brainUrl,
        BRAIN_API_KEY: brain.brainApiKey || ''
      }
    };
  }

  mcpConfigPath = path.join(os.tmpdir(), `claude-gui-mcp-${process.pid}.json`);
  fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
}

function cleanup() {
  if (currentProcess) currentProcess.kill('SIGTERM');
  if (permissionServer) permissionServer.close();
  if (mcpConfigPath) try { fs.unlinkSync(mcpConfigPath); } catch (e) {}
}

app.on('window-all-closed', () => {
  cleanup();
  app.quit();
});

app.on('before-quit', cleanup);

// Window controls
ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());

// Open external links
ipcMain.on('shell:open-external', (_, url) => {
  shell.openExternal(url);
});

// ===== Claude CLI Integration =====
ipcMain.on('claude:send-prompt', (event, data) => {
  const { prompt, sessionId, isFirst } = data;

  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
  }

  const claudeBin = findClaudeBinary();
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', mcpConfigPath,
    '--permission-prompt-tool', 'mcp__gui_permissions__approve_permission'
  ];

  if (sessionId) {
    if (isFirst) {
      args.push('--session-id', sessionId);
    } else {
      args.push('--resume', sessionId);
    }
  }

  const child = spawn(claudeBin, args, {
    env: {
      ...process.env,
      PATH: [
        process.env.PATH,
        path.join(os.homedir(), '.local', 'bin'),
        '/usr/local/bin'
      ].filter(Boolean).join(':')
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  currentProcess = child;

  child.stdin.write(prompt);
  child.stdin.end();

  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        processStreamEvent(event, obj);
      } catch (e) {
        // Skip malformed JSON
      }
    }
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    if (text.includes('Error') || text.includes('error')) {
      event.sender.send('claude:stream-error', text);
    }
  });

  child.on('close', (code) => {
    if (buffer.trim()) {
      try {
        processStreamEvent(event, JSON.parse(buffer));
      } catch (e) {}
    }
    currentProcess = null;
    event.sender.send('claude:stream-close', { code });
  });

  child.on('error', (err) => {
    currentProcess = null;
    event.sender.send('claude:stream-error', err.message);
  });
});

function processStreamEvent(event, obj) {
  if (obj.type === 'assistant' && obj.message) {
    const content = obj.message.content || [];
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        event.sender.send('claude:stream-delta', { text: block.text });
      }
      if (block.type === 'tool_use') {
        event.sender.send('claude:tool-use', {
          name: block.name,
          input: block.input
        });
      }
    }
  } else if (obj.type === 'result') {
    event.sender.send('claude:stream-end', {
      result: obj.result,
      cost: obj.total_cost_usd,
      duration: obj.duration_ms,
      model: Object.keys(obj.modelUsage || {})[0] || ''
    });
  }
}

ipcMain.on('claude:stop-generation', () => {
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
  }
});

// ===== Brain API (direct HTTP calls for the memories panel) =====
function getBrainCredentials() {
  const brain = loadBrainConfig();
  if (!brain || !brain.brainUrl) return null;
  return { url: brain.brainUrl, key: brain.brainApiKey || '' };
}

async function brainFetch(path, options = {}) {
  const brain = getBrainCredentials();
  if (!brain) throw new Error('Brain not configured');

  const headers = { 'Content-Type': 'application/json' };
  if (brain.key) headers['Authorization'] = `Bearer ${brain.key}`;

  const res = await fetch(`${brain.url}${path}`, { headers, ...options });
  if (!res.ok) throw new Error(`Brain API: ${res.status}`);
  return res.json();
}

ipcMain.handle('brain:list', async (_, category) => {
  const path = category ? `/memories?category=${encodeURIComponent(category)}` : '/memories';
  return brainFetch(path);
});

ipcMain.handle('brain:search', async (_, query) => {
  return brainFetch(`/memories/search?q=${encodeURIComponent(query)}`);
});

ipcMain.handle('brain:delete', async (_, id) => {
  return brainFetch(`/memories/${id}`, { method: 'DELETE' });
});

ipcMain.handle('brain:status', async () => {
  const brain = getBrainCredentials();
  return { configured: !!brain };
});
