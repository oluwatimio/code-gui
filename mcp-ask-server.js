#!/usr/bin/env node
// MCP Ask-User Server for Claude Code GUI
// Runs as a stdio MCP server spawned by Claude CLI.
// Exposes a single tool, `ask_user`, which surfaces a question to the GUI
// and blocks until the user answers. Communicates with the Electron app via HTTP.
//
// Tool input:
//   { question: string, options?: string[], multiSelect?: boolean, context?: string }
// Tool output:
//   Plain-text user answer (single string).

const http = require('http');
const ELECTRON_PORT = process.env.CLAUDE_GUI_PERMISSION_PORT;

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      // skip malformed
    }
  }
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleMessage(msg) {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'claude-gui-ask', version: '1.0.0' }
      }
    });
  } else if (msg.method === 'notifications/initialized') {
    // no response needed
  } else if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [{
          name: 'ask_user',
          description:
            'Ask the user a question and wait for their typed answer. Use this when you need clarification, a decision between options, or information only the user can provide — prefer asking over guessing when a choice materially affects the work. Provide `options` to offer suggested answers the user can pick from (they can still type a custom one). Returns the user\'s answer as plain text.',
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask. Keep it concise and specific.'
              },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional suggested answers. The user can pick one or type their own.'
              },
              context: {
                type: 'string',
                description: 'Optional additional context shown below the question to help the user answer.'
              }
            },
            required: ['question']
          }
        }]
      }
    });
  } else if (msg.method === 'tools/call') {
    const args = (msg.params && msg.params.arguments) || {};
    const question = String(args.question || '').trim();
    if (!question) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: 'Error: question is required' }],
          isError: true
        }
      });
      return;
    }

    try {
      const payload = {
        question,
        options: Array.isArray(args.options) ? args.options.map((s) => String(s)) : [],
        context: args.context ? String(args.context) : '',
        conv_id: process.env.CLAUDE_GUI_CONV_ID || null,
      };
      const guiResponse = await askElectronApp(payload);

      if (guiResponse.canceled) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: 'User canceled without answering.' }],
            isError: true
          }
        });
        return;
      }

      const answer = String(guiResponse.answer || '').trim();
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: answer || '(empty answer)' }]
        }
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `Error asking user: ${err.message}` }],
          isError: true
        }
      });
    }
  } else if (msg.id) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
}

function askElectronApp(payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port: ELECTRON_PORT,
      path: '/ask',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid response from GUI'));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
