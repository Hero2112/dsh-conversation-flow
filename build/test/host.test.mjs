/**
 * Standalone harness for the Conversation Flow Host half.
 *
 * Runs the real index.js against mocked Cordis services so the graph store,
 * catalogue composition, HTTP routes, transfer path, auto-coordination and the
 * tool definition can be exercised without restarting the Harness.
 */
import { EventEmitter } from 'node:events';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert';

const tmpHome = path.join(os.tmpdir(), 'cf-harness-' + process.pid);
process.env.DSH_HOME = tmpHome;
await fsp.rm(tmpHome, { recursive: true, force: true });

const { apply } = await import('../../dev/index.js');

/* ------------------------------------------------------------------ mocks */

const delivered = [];
const agentsById = new Map();
const listeners = new Map();
const routes = [];
const tools = [];
const disposers = [];

function makeAgent(id, status) {
  return {
    id,
    status,
    followup(message) {
      delivered.push({ agent: id, message });
    },
  };
}

const sessions = [
  {
    sessionId: 'session-alpha',
    updatedAt: Date.now() - 60_000,
    running: true,
    agentAvailable: true,
    blank: false,
    cwd: 'F:\\work\\alpha',
    projections: {
      kind: 'cached',
      asOfSeq: 12,
      values: {
        title: '架构讨论',
        turnOutline: { turns: [{ turn: 1, prompt: '设计数据通道', response: '先做手动通道，再做自动协调。' }], draft: '' },
        sessionStats: { lastTurn: 1 },
      },
    },
  },
  {
    sessionId: 'session-beta',
    updatedAt: Date.now() - 120_000,
    running: false,
    agentAvailable: true,
    blank: false,
    cwd: 'F:\\work\\beta',
    projections: {
      kind: 'cached',
      asOfSeq: 9,
      values: {
        title: '实现细节',
        turnOutline: { turns: [{ turn: 1, prompt: '开工', response: '收到，开始实现。' }], draft: '' },
        sessionStats: { lastTurn: 1 },
      },
    },
  },
  {
    sessionId: 'session-cold',
    updatedAt: Date.now() - 600_000,
    running: false,
    agentAvailable: false,
    blank: false,
    cwd: 'F:\\work\\gamma',
    projections: { kind: 'cached', asOfSeq: 3, values: { title: '历史归档' } },
  },
];

const eventLog = {
  'session-alpha': [
    { type: 'turn/start', seq: 1, time: Date.now() - 9000, data: { turn: 1 } },    { type: 'user/message', seq: 2, time: Date.now() - 8000, data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '设计数据通道' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 3, time: Date.now() - 7000, data: { turn: 1, step: 1, message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '先做手动通道，再做自动协调。' }], source: { kind: 'model', provider: 'p', model: 'm' } }, stream: [] } },
    { type: 'turn/end', seq: 4, time: Date.now() - 6000, data: { turn: 1, reason: { kind: 'completed' } } },
  ],
  'session-beta': [],
  'session-cold': [],
};

const ctx = {
  get(name) {
    if (name === 'webServer') {
      return {
        register(route) {
          routes.push(route);
          return () => routes.splice(routes.indexOf(route), 1);
        },
      };
    }
    if (name === 'sessionController') {
      return { async list() { return { items: sessions }; } };
    }
    if (name === 'sessionQuery') {
      return {
        async listSessions() {
          return sessions.map((item) => ({ header: { id: item.sessionId, createdAt: item.updatedAt, cwd: item.cwd, isSeeded: false }, live: item.agentAvailable, persisted: true }));
        },
        async readSurface(id) {
          return { events: eventLog[id] || [] };
        },
        async readTitle(id) {
          const found = sessions.find((item) => item.sessionId === id);
          return found ? { title: found.projections.values.title, updatedAt: found.updatedAt } : undefined;
        },
      };
    }
    if (name === 'agents') {
      return { get(id) { return agentsById.get(id); } };
    }
    if (name === 'workspaceRegistry') {
      return {
        list() {
          return [{ id: 'ws-1', title: '工作区一', sessionIds: ['session-alpha', 'session-beta', 'session-cold'] }];
        },
        archivedSessionIds: [],
      };
    }
    if (name === 'sessionProjectionCache') return undefined;
    if (name === 'tools') {
      return {
        register(definition) {
          tools.push(definition);
          return () => tools.splice(tools.indexOf(definition), 1);
        },
      };
    }
    return undefined;
  },
  on(event, listener) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(listener);
    return () => {
      const list = listeners.get(event) || [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    };
  },
  effect(callback) {
    const dispose = callback();
    if (typeof dispose === 'function') disposers.push(dispose);
    return dispose;
  },
};

apply(ctx, { schedulerIntervalMs: 40 });

/* ------------------------------------------------------------------ utils */

function call(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { 'sec-fetch-site': 'same-origin' };
  const res = {
    status: 0,
    headers: null,
    payload: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk) {
      this.payload = chunk || '';
    },
  };
  const done = routes[0].handler(req, res);
  // The handler awaits service lookups before attaching its body listeners, so
  // deliver the payload on a later tick; awaiting `done` keeps the ordering.
  setTimeout(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  }, 0);
  return Promise.resolve(done).then(() => {
    let json = null;
    try {
      json = JSON.parse(res.payload);
    } catch (error) {
      json = null;
    }
    return { status: res.status, json, text: res.payload };
  });
}

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

/* ------------------------------------------------------------------ cases */

check('route registered on /conversation-flow prefix', async () => {
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, '/conversation-flow');
});

check('GET state lists conversations with projection-derived metadata', async () => {
  const { status, json } = await call('GET', '/conversation-flow/api/state');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  const list = json.value.sessions;
  assert.equal(list.length, 3);
  const alpha = list.find((item) => item.id === 'session-alpha');
  assert.equal(alpha.title, '架构讨论');
  assert.equal(alpha.live, true);
  assert.equal(alpha.busy, true);
  assert.equal(alpha.turns, 1);
  assert.ok(alpha.preview.includes('先做手动通道'));
  assert.equal(alpha.workspaceTitle, '工作区一');
  const beta = list.find((item) => item.id === 'session-beta');
  assert.equal(beta.title, '实现细节');
  assert.equal(beta.busy, false);
  const cold = list.find((item) => item.id === 'session-cold');
  assert.equal(cold.live, false);
});

check('GET state is empty-graph on first run', async () => {
  const { json } = await call('GET', '/conversation-flow/api/state');
  assert.equal(json.value.graph.nodes.length, 0);
  assert.equal(json.value.graph.edges.length, 0);
  assert.equal(json.value.transfers.length, 0);
});

check('POST graph persists normalized nodes and edges', async () => {
  const graph = {
    nodes: [
      { id: 'n1', sessionId: 'session-alpha', x: 10, y: 20 },
      { id: 'n2', sessionId: 'session-beta', x: 300, y: 20 },
      { id: 'bad', sessionId: '', x: 0, y: 0 },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', kind: 'summary', auto: true, text: '', recentCount: 3 },
      { id: 'e2', source: 'n1', target: 'n1', kind: 'summary' },
      { id: 'e3', source: 'n1', target: 'missing', kind: 'summary' },
    ],
  };
  const saved = await call('POST', '/conversation-flow/api/graph', graph);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.value.nodes, 2);
  assert.equal(saved.json.value.edges, 1);
  const state = await call('GET', '/conversation-flow/api/state');
  assert.deepEqual(state.json.value.graph.nodes.map((node) => node.sessionId), ['session-alpha', 'session-beta']);
  assert.equal(state.json.value.graph.edges[0].auto, true);
});

check('graph file is written under DSH_HOME', async () => {
  const file = path.join(tmpHome, 'conversation-flow', 'graph.json');
  const raw = await fsp.readFile(file, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 2, 'state file is the topic-aware v2 shape');
  assert.equal(parsed.topics.length, 1, 'a fresh state owns exactly one default topic');
  assert.equal(parsed.activeTopicId, parsed.topics[0].id);
  assert.equal(parsed.topics[0].nodes.length, 2);
  assert.equal(parsed.topics[0].edges.length, 1);
  assert.equal(parsed.topics[0].canvas.variant, 'dots', 'default canvas look is persisted');
});

check('canvas look is validated, persisted and reported', async () => {
  const state = await call('GET', '/conversation-flow/api/state');
  const graph = state.json.value.graph;
  const saved = await call('POST', '/conversation-flow/api/graph', {
    nodes: graph.nodes,
    edges: graph.edges,
    canvas: { bgColor: '#1B2230', grid: false, variant: 'lines', gap: 34, gridColor: '#445566' },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.value.canvas, {
    bgColor: '#1b2230',
    grid: false,
    variant: 'lines',
    gap: 34,
    gridColor: '#445566',
  });
  const after = await call('GET', '/conversation-flow/api/state');
  assert.deepEqual(after.json.value.graph.canvas, saved.json.value.canvas);

  const file = path.join(tmpHome, 'conversation-flow', 'graph.json');
  const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.deepEqual(parsed.topics[0].canvas, saved.json.value.canvas, 'canvas survives on disk');
});

check('invalid canvas values fall back to safe defaults', async () => {
  const state = await call('GET', '/conversation-flow/api/state');
  const graph = state.json.value.graph;
  const saved = await call('POST', '/conversation-flow/api/graph', {
    nodes: graph.nodes,
    edges: graph.edges,
    canvas: { bgColor: 'red; background:url(x)', grid: 'yes', variant: 'zigzag', gap: 999, gridColor: '#GGG' },
  });
  assert.deepEqual(saved.json.value.canvas, {
    bgColor: null,
    grid: true,
    variant: 'dots',
    gap: 120,
    gridColor: null,
  });
});

check('a graph save without a canvas keeps the current look', async () => {
  const before = await call('GET', '/conversation-flow/api/state');
  const graph = before.json.value.graph;
  const saved = await call('POST', '/conversation-flow/api/graph', { nodes: graph.nodes, edges: graph.edges });
  assert.deepEqual(saved.json.value.canvas, graph.canvas, 'canvas is untouched by a nodes/edges-only save');
});

check('transfer refuses a conversation without a live agent', async () => {
  const response = await call('POST', '/conversation-flow/api/transfer', {
    source: 'n2',
    target: 'n3',
    kind: 'summary',
  });
  assert.equal(response.status, 409);
  assert.equal(response.json.ok, false);
  assert.equal(response.json.code, 'target-not-live');
});

check('transfer pushes the source last answer into the target inbox', async () => {
  // add a third node for the cold conversation to test the not-live path first
  const state = await call('GET', '/conversation-flow/api/state');
  const graph = state.json.value.graph;
  graph.nodes.push({ id: 'n3', sessionId: 'session-cold', x: 600, y: 20 });
  await call('POST', '/conversation-flow/api/graph', graph);

  const cold = await call('POST', '/conversation-flow/api/transfer', { source: 'n2', target: 'n3', kind: 'summary' });
  assert.equal(cold.status, 409);
  assert.equal(cold.json.code, 'target-not-live');
  assert.ok(cold.json.error.includes('打开'));

  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  const ok = await call('POST', '/conversation-flow/api/transfer', { source: 'n1', target: 'n2', kind: 'summary' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.value.ok, true);
  assert.ok(ok.json.value.chars > 0);
  assert.equal(delivered.length, 1);
  const message = delivered[0].message;
  assert.equal(delivered[0].agent, 'session-beta');
  assert.equal(message.role, 'user');
  assert.deepEqual(message.source, { kind: 'user' });
  assert.match(message.content[0].text, /对话流·最后一轮回答/);
  assert.match(message.content[0].text, /架构讨论/);
  assert.match(message.content[0].text, /先做手动通道/);
});

check('recent payload carries both roles', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  const ok = await call('POST', '/conversation-flow/api/transfer', { source: 'n1', target: 'n2', kind: 'recent', recentCount: 3 });
  assert.equal(ok.status, 200);
  const text = delivered[delivered.length - 1].message.content[0].text;
  assert.match(text, /【用户】设计数据通道/);
  assert.match(text, /【助手】先做手动通道/);
});

check('custom payload passes the configured text through', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  const ok = await call('POST', '/conversation-flow/api/transfer', {
    source: 'n1',
    target: 'n2',
    kind: 'custom',
    text: '请基于上面的架构结论继续实现。',
  });
  assert.equal(ok.status, 200);
  const text = delivered[delivered.length - 1].message.content[0].text;
  assert.match(text, /请基于上面的架构结论继续实现。/);
  assert.match(text, /自定义文本/);
});

check('turn end triggers the automatic channel once and respects the loop guard', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  const before = delivered.length;
  const event = { type: 'turn/end', seq: 5, time: Date.now(), data: { turn: 2, reason: { kind: 'completed' } } };
  for (const listener of listeners.get('session/event') || []) listener({ id: 'session-alpha' }, event);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(delivered.length, before + 1, 'exactly one automatic delivery');
  assert.match(delivered[delivered.length - 1].message.content[0].text, /自动协调/);

  // second immediate turn end is suppressed by the 15s guard
  for (const listener of listeners.get('session/event') || []) listener({ id: 'session-alpha' }, event);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(delivered.length, before + 1, 'loop guard suppressed the duplicate');

  // a non-completed turn never pushes
  const aborted = { type: 'turn/end', seq: 6, time: Date.now(), data: { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } } };
  for (const listener of listeners.get('session/event') || []) listener({ id: 'session-alpha' }, aborted);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(delivered.length, before + 1);
});

check('node role, output and schedule persist and are validated', async () => {
  const state = await call('GET', '/conversation-flow/api/state');
  const graph = state.json.value.graph;
  const nodes = graph.nodes.map((node) =>
    node.id === 'n1'
      ? { ...node, role: '架构决策', output: '', schedule: { enabled: true, everyMinutes: 15 } }
      : node,
  );
  const saved = await call('POST', '/conversation-flow/api/graph', { nodes, edges: graph.edges, canvas: graph.canvas });
  assert.equal(saved.status, 200);
  const after = await call('GET', '/conversation-flow/api/state');
  const n1 = after.json.value.graph.nodes.find((node) => node.id === 'n1');
  assert.equal(n1.role, '架构决策');
  assert.deepEqual(n1.schedule, { enabled: true, everyMinutes: 15 });
  assert.equal(n1.output, '');

  const bad = await call('POST', '/conversation-flow/api/node', {
    nodeId: 'n1',
    role: 'x'.repeat(400),
    schedule: { enabled: 'yes', everyMinutes: 9999 },
  });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.value.role.length, 200, 'role is capped');
  assert.deepEqual(bad.json.value.schedule, { enabled: false, everyMinutes: 720 }, 'bad values fall back');
  // restore the tested node
  await call('POST', '/conversation-flow/api/node', {
    nodeId: 'n1',
    role: '架构决策',
    output: '',
    schedule: { enabled: false, everyMinutes: 10 },
  });
});

check('POST node patches role, output and timer', async () => {
  const patched = await call('POST', '/conversation-flow/api/node', {
    nodeId: 'n1',
    role: '架构决策',
    output: '',
    schedule: { enabled: false, everyMinutes: 5 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.value.role, '架构决策');
  assert.deepEqual(patched.json.value.schedule, { enabled: false, everyMinutes: 5 });
  const missing = await call('POST', '/conversation-flow/api/node', { nodeId: 'nope', role: 'x' });
  assert.equal(missing.status, 404);
});

check('node output overrides the payload and the header names the role', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  await call('POST', '/conversation-flow/api/node', { nodeId: 'n1', output: '节点固定输出：按方案 B 实现。' });
  const ok = await call('POST', '/conversation-flow/api/transfer', { source: 'n1', target: 'n2', kind: 'summary' });
  assert.equal(ok.status, 200);
  const text = delivered[delivered.length - 1].message.content[0].text;
  assert.match(text, /节点输出/, 'payload meta switches to the node output');
  assert.match(text, /节点固定输出：按方案 B 实现。/);
  assert.match(text, /·架构决策/, 'header carries the node role');
  assert.equal(ok.json.value.kindLabel, '节点输出');
  await call('POST', '/conversation-flow/api/node', { nodeId: 'n1', output: '' });
});

check('POST run drives the node and delivers when its turn ends', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  agentsById.set('session-alpha', makeAgent('session-alpha', 'idle'));
  await call('POST', '/conversation-flow/api/node', { nodeId: 'n1', schedule: { enabled: true, everyMinutes: 10 } });
  const run = await call('POST', '/conversation-flow/api/run', { nodeId: 'n1' });
  assert.equal(run.status, 200);
  assert.equal(run.json.value.kicked, true, 'the role drove a turn');
  assert.equal(run.json.value.pending, true, 'the push waits for that turn');
  assert.equal(run.json.value.sent, 0);

  const kicked = delivered[delivered.length - 1];
  assert.equal(kicked.agent, 'session-alpha', 'the instruction went into the node own conversation');
  assert.match(kicked.message.content[0].text, /【对话流·节点执行】/);
  assert.match(kicked.message.content[0].text, /职责：架构决策/);

  // the driven turn finishes -> the fresh result is delivered downstream
  const beforeBeta = delivered.filter((item) => item.agent === 'session-beta').length;
  const event = { type: 'turn/end', seq: 9, time: Date.now(), data: { turn: 5, reason: { kind: 'completed' } } };
  for (const listener of listeners.get('session/event') || []) listener({ id: 'session-alpha' }, event);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const betaDeliveries = delivered.filter((item) => item.agent === 'session-beta');
  assert.equal(betaDeliveries.length, beforeBeta + 1, 'exactly one downstream delivery for the driven turn');
  assert.match(betaDeliveries[betaDeliveries.length - 1].message.content[0].text, /定时触发/);
  const state = await call('GET', '/conversation-flow/api/state');
  const node = state.json.value.graph.nodes.find((item) => item.id === 'n1');
  assert.equal(node.pendingAt, 0, 'the pending flag is cleared once fulfilled');

  const missing = await call('POST', '/conversation-flow/api/run', { nodeId: 'nope' });
  assert.equal(missing.status, 404);
});

check('a fixed output is delivered without waiting for a turn', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  await call('POST', '/conversation-flow/api/node', { nodeId: 'n1', role: '架构决策', output: '固定交付文本' });
  const before = delivered.length;
  const run = await call('POST', '/conversation-flow/api/run', { nodeId: 'n1' });
  assert.equal(run.status, 200);
  assert.equal(run.json.value.kicked, true);
  assert.equal(run.json.value.pending, false);
  assert.equal(run.json.value.sent, 1);
  assert.equal(delivered.length, before + 2, 'instruction + downstream push'); // kick + push
  const pushed = delivered[delivered.length - 1];
  assert.equal(pushed.agent, 'session-beta');
  assert.match(pushed.message.content[0].text, /固定交付文本/);
  await call('POST', '/conversation-flow/api/node', { nodeId: 'n1', output: '', schedule: { enabled: false, everyMinutes: 10 } });
});

check('the scheduler fires a timed node once per window', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  // A dedicated source keeps this check independent of the loop guard used above.
  sessions.push({
    sessionId: 'session-delta',
    updatedAt: Date.now(),
    running: false,
    agentAvailable: true,
    blank: false,
    cwd: 'F:\\work\\delta',
    projections: {
      kind: 'cached',
      asOfSeq: 2,
      values: { title: '定时源', turnOutline: { turns: [], draft: '' }, sessionStats: { lastTurn: 1 } },
    },
  });
  eventLog['session-delta'] = [
    {
      type: 'assistant/message',
      seq: 2,
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        message: { id: 'm9', role: 'assistant', content: [{ type: 'text', text: '定时推送的内容' }], source: { kind: 'model', provider: 'p', model: 'm' } },
        stream: [],
      },
    },
  ];

  const state = await call('GET', '/conversation-flow/api/state');
  const graph = state.json.value.graph;
  const nodes = graph.nodes.map((node) =>
    node.id === 'n1' ? { ...node, lastRunAt: 0, schedule: { enabled: false, everyMinutes: 1 } } : node,
  );
  nodes.push({ id: 'n4', sessionId: 'session-delta', x: 900, y: 20, role: '定时节点', output: '', schedule: { enabled: true, everyMinutes: 1 }, lastRunAt: 0 });
  agentsById.set('session-delta', makeAgent('session-delta', 'idle'));
  const edges = [...graph.edges, { id: 'e4', source: 'n4', target: 'n2', kind: 'summary', auto: false, text: '', recentCount: 3 }];
  // Capture the baseline before the save: the ticker may already fire while the
  // route is still awaiting persistence.
  const before = delivered.length;
  await call('POST', '/conversation-flow/api/graph', { nodes, edges, canvas: graph.canvas });

  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(delivered.length, before + 1, 'the ticker drove the node exactly once');
  const kick = delivered[delivered.length - 1];
  assert.equal(kick.agent, 'session-delta', 'the role instruction went into the timed node conversation');
  assert.match(kick.message.content[0].text, /职责：定时节点/);
  assert.match(kick.message.content[0].text, /定时任务触发/);

  // the driven turn ends -> the fresh answer is pushed downstream
  const betaBefore = delivered.filter((item) => item.agent === 'session-beta').length;
  const turnEnd = { type: 'turn/end', seq: 20, time: Date.now(), data: { turn: 2, reason: { kind: 'completed' } } };
  for (const listener of listeners.get('session/event') || []) listener({ id: 'session-delta' }, turnEnd);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(delivered.filter((item) => item.agent === 'session-beta').length, betaBefore + 1);
  assert.match(delivered[delivered.length - 1].message.content[0].text, /定时推送的内容/);
  const restAfterWindow = delivered.length;
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(delivered.length, restAfterWindow, 'a second window has not elapsed yet');

  // switching the timer off stops the ticker for that node
  await call('POST', '/conversation-flow/api/node', { nodeId: 'n4', schedule: { enabled: false, everyMinutes: 1 } });
  const afterState = (await call('GET', '/conversation-flow/api/state')).json.value.graph;
  const nodes2 = afterState.nodes.map((node) => (node.id === 'n4' ? { ...node, lastRunAt: 0 } : node));
  await call('POST', '/conversation-flow/api/graph', { nodes: nodes2, edges: afterState.edges, canvas: afterState.canvas });
  const settled = delivered.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(delivered.length, settled, 'a disabled timer never fires');
});


check('turning automatic off stops coordination', async () => {
  const state = await call('GET', '/conversation-flow/api/state');
  const edge = state.json.value.graph.edges[0];
  const off = await call('POST', '/conversation-flow/api/coordinate', { edgeId: edge.id, enabled: false });
  assert.equal(off.status, 200);
  assert.equal(off.json.value.auto, false);
  const before = delivered.length;
  const event = { type: 'turn/end', seq: 7, time: Date.now(), data: { turn: 4, reason: { kind: 'completed' } } };
  for (const listener of listeners.get('session/event') || []) listener({ id: 'session-alpha' }, event);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(delivered.length, before);
});

check('transfer log records both successes and refusals', async () => {
  const { json } = await call('GET', '/conversation-flow/api/state');
  const log = json.value.transfers;
  assert.ok(log.length >= 5, 'expected several log rows, got ' + log.length);
  assert.ok(log.some((item) => item.ok === true));
  assert.ok(log.some((item) => item.ok === false));
  assert.ok(log[0].at, 'newest first with timestamp');
});

check('cross-site requests are refused', async () => {
  const req = new EventEmitter();
  req.method = 'GET';
  req.url = '/conversation-flow/api/state';
  req.headers = { 'sec-fetch-site': 'cross-site' };
  const res = { writeHead(status) { this.status = status; }, end() {} };
  await routes[0].handler(req, res);
  req.emit('end');
  assert.equal(res.status, 403);
});

check('unknown route answers 404 JSON', async () => {
  const response = await call('GET', '/conversation-flow/api/nope');
  assert.equal(response.status, 404);
  assert.equal(response.json.ok, false);
});

check('plugin registers exactly one conversation_flow tool', async () => {
  assert.equal(tools.length, 1);
  const definition = tools[0];
  assert.equal(definition.name, 'conversation_flow');
  assert.equal(definition.parameters.type, 'object');
  assert.deepEqual(definition.parameters.required, ['action']);
  assert.deepEqual(definition.output.schema, { type: 'string' });
  assert.equal(typeof definition.execute, 'function');
  assert.equal(typeof definition.output.render, 'function');
  const rendered = definition.output.render({ action: 'list' }, 'ok');
  assert.deepEqual(rendered, [{ type: 'text', text: 'ok' }]);
});

check('tool: list reports conversations and liveness', async () => {
  const text = await tools[0].execute({ action: 'list' }, {});
  assert.match(text, /架构讨论/);
  assert.match(text, /session-alpha/);
  assert.match(text, /已打开/);
});

check('tool: state reports the canvas', async () => {
  const text = await tools[0].execute({ action: 'state' }, {});
  assert.match(text, /节点 n1/);
  assert.match(text, /通道 e1/);
});

check('tool: link creates a channel, transfer uses it', async () => {
  const link = await tools[0].execute({ action: 'link', source: 'session-alpha', target: 'session-beta', auto: false }, {});
  assert.match(link, /已建立通道|已更新通道/);
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  const before = delivered.length;
  const result = await tools[0].execute({ action: 'transfer', source: 'session-alpha', target: 'session-beta', kind: 'summary' }, {});
  assert.match(result, /已把 \d+ 字/);
  assert.equal(delivered.length, before + 1);
});

check('tool: coordinate toggles an edge', async () => {
  const state = await call('GET', '/conversation-flow/api/state');
  const edge = state.json.value.graph.edges[0];
  const text = await tools[0].execute({ action: 'coordinate', edge_id: edge.id, auto: true }, {});
  assert.match(text, /自动协调已开启/);
});

check('tool: node edits role, output and timer', async () => {
  const text = await tools[0].execute(
    { action: 'node', node_id: 'n1', role: '架构决策', output: '固定输出文本', schedule: true, every_minutes: 7 },
    {},
  );
  assert.match(text, /已更新/);
  assert.match(text, /每 7 分钟/);
  const state = await call('GET', '/conversation-flow/api/state');
  const node = state.json.value.graph.nodes.find((item) => item.id === 'n1');
  assert.equal(node.role, '架构决策');
  assert.equal(node.output, '固定输出文本');
  assert.deepEqual(node.schedule, { enabled: true, everyMinutes: 7 });
  // restore for later checks
  await tools[0].execute({ action: 'node', node_id: 'n1', output: '', schedule: false }, {});
});

check('tool: run drives a node by its role', async () => {
  agentsById.set('session-alpha', makeAgent('session-alpha', 'idle'));
  const before = delivered.length;
  const text = await tools[0].execute({ action: 'run', node_id: 'n1' }, {});
  assert.match(text, /已按其职责驱动对话|已驱动对话/);
  assert.equal(delivered.length, before + 1);
  assert.equal(delivered[delivered.length - 1].agent, 'session-alpha');
});

check('malformed JSON body is reported as an error, not a crash', async () => {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/conversation-flow/api/graph';
  req.headers = {};
  const res = { writeHead(status) { this.status = status; }, end(chunk) { this.payload = chunk; } };
  const done = routes[0].handler(req, res);
  setTimeout(() => {
    req.emit('data', Buffer.from('{not json'));
    req.emit('end');
  }, 0);
  await done;
  assert.equal(res.status, 500);
  assert.match(String(res.payload), /invalid JSON/);
});

/* ---------------------------------------------------------------- topics */

check('topics: a default topic exists and is active', async () => {
  const state = await call('GET', '/conversation-flow/api/state');
  const value = state.json.value;
  assert.equal(value.topics.length, 1);
  assert.equal(value.topics[0].id, value.activeTopicId);
  assert.equal(value.graph.topicId, value.activeTopicId);
  assert.equal(typeof value.topics[0].name, 'string');
  assert.ok(value.topics[0].nodeCount > 0);
});

check('topics: create / select / rename / delete keep the canvases isolated', async () => {
  const before = await call('GET', '/conversation-flow/api/state');
  const defaultId = before.json.value.activeTopicId;
  const baseGraph = before.json.value.graph;
  const baseCount = baseGraph.nodes.length;

  // 主题 A 里再加一个节点
  await call('POST', '/conversation-flow/api/graph', {
    nodes: [...baseGraph.nodes, { id: 'topic-a-extra', sessionId: 'session-alpha', x: 1, y: 1 }],
    edges: baseGraph.edges,
    canvas: baseGraph.canvas,
  });

  const created = await call('POST', '/conversation-flow/api/topic', { action: 'create', name: '第二主题' });
  assert.equal(created.status, 200);
  assert.equal(created.json.value.topics.length, 2);
  const secondId = created.json.value.activeTopicId;
  assert.notEqual(secondId, defaultId);
  assert.ok(created.json.value.topics.some((topic) => topic.name === '第二主题'));

  // 新主题是空白画布
  const fresh = await call('GET', '/conversation-flow/api/state');
  assert.equal(fresh.json.value.graph.nodes.length, 0);
  assert.equal(fresh.json.value.graph.topicId, secondId);

  // 在新主题里放另一个节点
  await call('POST', '/conversation-flow/api/graph', {
    nodes: [{ id: 'topic-b-node', sessionId: 'session-beta', x: 5, y: 5 }],
    edges: [],
  });

  // 改名
  const renamed = await call('POST', '/conversation-flow/api/topic', {
    action: 'rename',
    topicId: secondId,
    name: '第二主题·改名',
  });
  assert.equal(renamed.status, 200);
  assert.ok(renamed.json.value.topics.some((topic) => topic.name === '第二主题·改名'));

  // 切回默认主题，看到的是默认主题的画布（而不是第二个主题的）
  const back = await call('POST', '/conversation-flow/api/topic', { action: 'select', topicId: defaultId });
  assert.equal(back.status, 200);
  const restored = await call('GET', '/conversation-flow/api/state');
  assert.equal(restored.json.value.graph.nodes.length, baseCount + 1);
  assert.ok(restored.json.value.graph.nodes.some((node) => node.id === 'topic-a-extra'));
  assert.equal(restored.json.value.graph.nodes.some((node) => node.id === 'topic-b-node'), false);

  // 统计与更新时间也回来了
  assert.equal(restored.json.value.topics.length, 2);

  // 删除第二个主题
  const deleted = await call('POST', '/conversation-flow/api/topic', { action: 'delete', topicId: secondId });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.json.value.topics.length, 1);

  // 最后一个主题不允许删除
  const guard = await call('POST', '/conversation-flow/api/topic', { action: 'delete', topicId: defaultId });
  assert.equal(guard.status, 409);
  assert.match(guard.json.error, /至少/);
});

check('topics: a timed node in another topic still fires', async () => {
  agentsById.set('session-beta', makeAgent('session-beta', 'idle'));
  const created = await call('POST', '/conversation-flow/api/topic', { action: 'create', name: '定时主题' });
  const topicId = created.json.value.activeTopicId;
  await call('POST', '/conversation-flow/api/graph', {
    nodes: [
      {
        id: 'n-timed',
        sessionId: 'session-beta',
        x: 0,
        y: 0,
        role: '',
        output: '定时主题的输出',
        schedule: { enabled: true, everyMinutes: 1 },
        lastRunAt: 0,
      },
      { id: 'n-target', sessionId: 'session-alpha', x: 200, y: 0 },
    ],
    edges: [{ id: 'e-timed', source: 'n-timed', target: 'n-target', kind: 'summary', auto: false }],
  });
  const before = delivered.length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(delivered.length, before + 1, 'the ticker runs nodes of a non-active topic');
  assert.match(delivered[delivered.length - 1].message.content[0].text, /定时主题的输出/);
  // 清理：删除这个主题，回到默认主题
  const deleted = await call('POST', '/conversation-flow/api/topic', { action: 'delete', topicId });
  assert.equal(deleted.status, 200);
});

check('tool: topics / topic actions', async () => {
  const listed = await tools[0].execute({ action: 'topics' }, {});
  assert.match(listed, /▶/);
  const created = await tools[0].execute({ action: 'topic', topic_op: 'create', name: '工具主题' }, {});
  assert.match(created, /已创建主题「工具主题」/);
  const state = await call('GET', '/conversation-flow/api/state');
  const topicId = state.json.value.activeTopicId;
  const renamed = await tools[0].execute({ action: 'topic', topic_op: 'rename', topic_id: topicId, name: '工具主题·改名' }, {});
  assert.match(renamed, /已改名/);
  const removed = await tools[0].execute({ action: 'topic', topic_op: 'delete', topic_id: topicId }, {});
  assert.match(removed, /已删除主题/);
});

/* ------------------------------------------------------------------- run */

let failed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log('PASS  ' + name);
  } catch (error) {
    failed += 1;
    console.log('FAIL  ' + name + '\n      ' + (error && error.message ? error.message : error));
  }
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed');
process.exit(failed === 0 ? 0 : 1);
