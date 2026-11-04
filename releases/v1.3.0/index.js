/**
 * Conversation Flow — Host half.
 *
 * Owns the durable conversation graph (which conversations are on the canvas,
 * which data channels connect them, which channels run automatically) and the
 * actual transfer of content from one conversation's log into another
 * conversation's agent inbox.
 *
 * Everything the browser half needs is served from same-origin routes under
 * `/conversation-flow/api`. The same operations are exposed to the agent
 * through the `conversation_flow` tool, so the UI and the model share one
 * implementation.
 *
 * @module @local/dsh-conversation-flow
 */

import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const name = 'conversation-flow';

/** Everything is looked up optionally, so the plugin stays inert in profiles without these services. */
export const inject = [];

const API_PREFIX = '/conversation-flow/api';
const GRAPH_ROUTE = '/conversation-flow';
const MAX_SESSIONS = 80;
const MAX_TRANSFERS = 40;
const MAX_PAYLOAD_CHARS = 8000;
const LOOP_GUARD_MS = 15000;
const MAX_CHAIN_DEPTH = 3;

/* ------------------------------------------------------------------ state */

function stateFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'conversation-flow', 'graph.json');
}

function emptyState() {
  return { version: 1, rev: 1, nodes: [], edges: [], transfers: [], canvas: defaultCanvas() };
}

/** Canvas presentation: `null` means "follow the Harness theme". */
function defaultCanvas() {
  return { bgColor: null, grid: true, variant: 'dots', gap: 22, gridColor: null };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function cleanColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

function normalizeCanvas(raw) {
  const base = defaultCanvas();
  if (!raw || typeof raw !== 'object') return base;
  return {
    bgColor: cleanColor(raw.bgColor),
    grid: raw.grid !== false,
    variant: ['dots', 'lines', 'cross'].includes(raw.variant) ? raw.variant : base.variant,
    gap: Number.isFinite(raw.gap) ? Math.min(120, Math.max(8, Math.round(raw.gap))) : base.gap,
    gridColor: cleanColor(raw.gridColor),
  };
}

/** Per-node role text is a short label, the output is a payload-sized text. */
const MAX_ROLE_CHARS = 200;
const MIN_SCHEDULE_MINUTES = 1;
const MAX_SCHEDULE_MINUTES = 720;

/** `schedule.enabled` marks a node that pushes on a timer; `lastRunAt` is persisted so a
 *  reload does not re-fire a node that already ran inside its window. */
function normalizeSchedule(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const minutes = Number.isFinite(source.everyMinutes) ? Math.round(source.everyMinutes) : 10;
  return {
    enabled: source.enabled === true,
    everyMinutes: Math.min(MAX_SCHEDULE_MINUTES, Math.max(MIN_SCHEDULE_MINUTES, minutes)),
  };
}

function normalizeGraph(raw) {
  const nodes = Array.isArray(raw && raw.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw && raw.edges) ? raw.edges : [];
  const seen = new Set();
  const cleanNodes = [];
  for (const node of nodes) {
    if (!node || typeof node.sessionId !== 'string' || node.sessionId.length === 0) continue;
    const id = typeof node.id === 'string' && node.id.length > 0 ? node.id : 'n' + randomUUID().slice(0, 8);
    if (seen.has(id)) continue;
    seen.add(id);
    cleanNodes.push({
      id,
      sessionId: node.sessionId,
      x: Number.isFinite(node.x) ? Math.round(node.x) : 0,
      y: Number.isFinite(node.y) ? Math.round(node.y) : 0,
      role: typeof node.role === 'string' ? node.role.slice(0, MAX_ROLE_CHARS) : '',
      output: typeof node.output === 'string' ? node.output.slice(0, MAX_PAYLOAD_CHARS) : '',
      schedule: normalizeSchedule(node.schedule),
      lastRunAt: Number.isFinite(node.lastRunAt) ? node.lastRunAt : 0,
      pendingAt: Number.isFinite(node.pendingAt) ? node.pendingAt : 0,
    });
  }
  const nodeIds = new Set(cleanNodes.map((node) => node.id));
  const cleanEdges = [];
  for (const edge of edges) {
    if (!edge || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    const id = typeof edge.id === 'string' && edge.id.length > 0 ? edge.id : 'e' + randomUUID().slice(0, 8);
    cleanEdges.push({
      id,
      source: edge.source,
      target: edge.target,
      kind: ['summary', 'recent', 'transcript', 'custom'].includes(edge.kind) ? edge.kind : 'summary',
      auto: edge.auto === true,
      text: typeof edge.text === 'string' ? edge.text.slice(0, MAX_PAYLOAD_CHARS) : '',
      recentCount: Number.isFinite(edge.recentCount) ? Math.min(20, Math.max(1, Math.round(edge.recentCount))) : 3,
    });
  }
  return { nodes: cleanNodes, edges: cleanEdges, canvas: normalizeCanvas(raw && raw.canvas) };
}

/* --------------------------------------------------------------- helpers */

function textOfContent(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function truncate(text, max = MAX_PAYLOAD_CHARS) {
  if (typeof text !== 'string') return '';
  return text.length > max ? text.slice(0, max) + '\n…（已截断 ' + (text.length - max) + ' 字）' : text;
}

function preview(text, max = 120) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

function relativeTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const delta = Date.now() - ms;
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return Math.floor(delta / 60_000) + ' 分钟前';
  if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + ' 小时前';
  return Math.floor(delta / 86_400_000) + ' 天前';
}

function readJsonBody(req, limitBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------- plugin */

export function apply(ctx, config = {}) {
  const sessionQuery = () => ctx.get('sessionQuery');
  const agents = () => ctx.get('agents');
  const sessionController = () => ctx.get('sessionController');
  const workspaceRegistry = () => ctx.get('workspaceRegistry');
  const projectionCache = () => ctx.get('sessionProjectionCache');
  const webServer = () => ctx.get('webServer');

  let state = emptyState();
  let stateLoaded = false;
  let saveTimer = null;
  /** edge key `"<source>-><target>"` -> timestamp of our last delivery (loop guard). */
  const recentDeliveries = new Map();
  /** Registration outcome, surfaced by `/api/state` so a Host-side failure is diagnosable. */
  const toolRegistration = { status: 'not-attempted', error: null };

  async function persist() {
    state.rev += 1;
    const file = stateFile();
    const body = JSON.stringify(state, null, 2);
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      await fsp.writeFile(tmp, body, 'utf8');
      await fsp.rename(tmp, file);
    } catch (error) {
      console.error('[conversation-flow] failed to persist graph:', error && error.message ? error.message : error);
    }
  }

  function schedulePersist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persist();
    }, 150);
  }

  async function ensureLoaded() {
    if (stateLoaded) return;
    stateLoaded = true;
    try {
      const raw = await fsp.readFile(stateFile(), 'utf8');
      const parsed = JSON.parse(raw);
      const graph = normalizeGraph(parsed);
      state = {
        version: 1,
        rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
        nodes: graph.nodes,
        edges: graph.edges,
        transfers: Array.isArray(parsed.transfers) ? parsed.transfers.slice(0, MAX_TRANSFERS) : [],
        canvas: graph.canvas,
      };
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        console.error('[conversation-flow] unreadable graph state, starting empty:', error && error.message);
      }
    }
  }

  /* ---------------------------------------------------- session catalogue */

  function cachedValues(header, keys) {
    const cache = projectionCache();
    if (!cache || typeof cache.cachedSnapshot !== 'function') return {};
    try {
      const snapshot = cache.cachedSnapshot(header, keys);
      return (snapshot && snapshot.values) || {};
    } catch (error) {
      return {};
    }
  }

  function projectionValuesOf(summary) {
    const hints = summary && summary.projections;
    if (hints && hints.values && typeof hints.values === 'object') return hints.values;
    return {};
  }

  function describeSession(input) {
    const { id, header, summary, record } = input;
    const agentService = agents();
    const agent = agentService && typeof agentService.get === 'function' ? agentService.get(id) : undefined;
    const values = summary ? projectionValuesOf(summary) : cachedValues(header || { id }, ['title', 'turnOutline', 'sessionStats', 'sessionListMetadata']);
    const title = typeof values.title === 'string' && values.title.length > 0 ? values.title : null;
    const outline = values.turnOutline;
    const stats = values.sessionStats;
    const listMeta = values.sessionListMetadata;
    const turnsInOutline = outline && Array.isArray(outline.turns) ? outline.turns.length : 0;
    const lastTurn = turnsInOutline > 0 ? outline.turns[turnsInOutline - 1] : null;
    const turnCount = stats && Number.isFinite(stats.lastTurn) ? stats.lastTurn : turnsInOutline;
    const lastPromptAt = listMeta && typeof listMeta.lastPromptAt === 'number' ? listMeta.lastPromptAt : null;
    const createdAt = header && Number.isFinite(header.createdAt) ? header.createdAt : 0;
    const updatedAt =
      (summary && Number.isFinite(summary.updatedAt) ? summary.updatedAt : 0) || lastPromptAt || createdAt;
    return {
      id,
      title: title || '对话 ' + String(id).slice(-6),
      fallbackTitle: !title,
      cwd: (header && header.cwd) || (summary && summary.cwd) || null,
      createdAt,
      updatedAt,
      updatedText: relativeTime(updatedAt),
      live: agent !== undefined || (summary ? summary.agentAvailable === true : false),
      busy: agent !== undefined ? agent.status === 'running' : summary ? summary.running === true : false,
      blank: summary ? summary.blank === true : false,
      isSubagent: (header && header.origin === 'subagent') || (summary && summary.origin === 'subagent') || false,
      parentSessionId: (header && header.parentSession) || (summary && summary.parentSessionId) || null,
      projectionKind: summary && summary.projections ? summary.projections.kind : null,
      detailSource: outline ? 'projection' : 'header',
      turns: turnCount,
      preview: preview(lastTurn ? lastTurn.response || lastTurn.prompt || '' : ''),
      hasDraft: !!(outline && typeof outline.draft === 'string' && outline.draft.length > 0),
      archived: record && record.persisted === true ? false : undefined,
    };
  }

  /**
   * Conversation catalogue. Primary source is `sessionController.list()`, whose
   * cached projection hints already carry title/turnOutline for every session, so
   * one call covers the whole rail. `sessionQuery.listSessions()` fills headers
   * that the controller list does not surface (cold or non-visible sessions).
   */
  async function listSessions() {
    const controller = sessionController();
    const query = sessionQuery();
    const registry = workspaceRegistry();
    const byId = new Map();
    const order = [];

    if (controller && typeof controller.list === 'function') {
      try {
        const value = await controller.list({}, AbortSignal.timeout(8000));
        const items = (value && value.items) || [];
        for (const summary of items) {
          const id = summary && summary.sessionId;
          if (typeof id !== 'string') continue;
          if (!byId.has(id)) order.push(id);
          byId.set(id, { id, summary });
        }
      } catch (error) {
        console.error('[conversation-flow] sessionController.list failed:', error && error.message);
      }
    }

    if (byId.size === 0 && query && typeof query.listSessions === 'function') {
      let records = [];
      try {
        records = await query.listSessions(AbortSignal.timeout(8000));
      } catch (error) {
        console.error('[conversation-flow] listSessions failed:', error && error.message);
        return [];
      }
      for (const record of records) {
        const header = record && record.header;
        if (!header || typeof header.id !== 'string') continue;
        if (!byId.has(header.id)) order.push(header.id);
        byId.set(header.id, { id: header.id, header, record });
      }
    }

    const workspaces = registry && typeof registry.list === 'function' ? registry.list() : [];
    const archived = registry && registry.archivedSessionIds ? registry.archivedSessionIds : [];
    const archivedSet = new Set(archived);

    const sessions = [];
    for (const id of order.slice(0, MAX_SESSIONS)) {
      const entry = byId.get(id);
      const session = describeSession(entry);
      const workspace = workspaces.find(
        (item) => item && Array.isArray(item.sessionIds) && item.sessionIds.includes(id),
      );
      session.workspaceId = workspace ? workspace.id : null;
      session.workspaceTitle = workspace ? workspace.title : null;
      session.archived = archivedSet.has(id);
      sessions.push(session);
    }
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // Canvas nodes need real content even when a projection hint is stale or absent.
    const canvasIds = new Set(
      (state.nodes || []).map((node) => node.sessionId).filter((id) => typeof id === 'string'),
    );
    let budget = 8;
    for (const session of sessions) {
      if (!canvasIds.has(session.id) || (session.preview && session.turns > 0) || budget <= 0) continue;
      budget -= 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const detail = await readSessionDetail(session.id);
        session.turns = session.turns || detail.turns;
        if (!session.preview) session.preview = preview(detail.lastText);
        session.detailSource = 'log';
      } catch (error) {
        /* keep the projection-derived value */
      }
    }
    return sessions;
  }

  /** Full-log read (turn boundaries included); falls back to the surface read. */
  async function readSessionDetail(sessionId) {
    const query = sessionQuery();
    if (query && typeof query.readSession === 'function') {
      const snapshot = await query.readSession(sessionId);
      const events = (snapshot && snapshot.events) || [];
      let lastText = '';
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event && event.type === 'assistant/message') {
          const text = textOfContent(event.data && event.data.message && event.data.message.content);
          if (text.length > 0) {
            lastText = text;
            break;
          }
        }
      }
      return { turns: countTurns(events), lastText, events };
    }
    const read = await readMessages(sessionId);
    const last = read.messages.length > 0 ? read.messages[read.messages.length - 1] : null;
    return { turns: read.turns, lastText: last ? last.text : '', events: [] };
  }

  async function sessionTitle(sessionId) {
    const query = sessionQuery();
    if (query && typeof query.readTitle === 'function') {
      try {
        const snapshot = await query.readTitle(sessionId, AbortSignal.timeout(4000));
        if (snapshot && typeof snapshot.title === 'string' && snapshot.title.length > 0) return snapshot.title;
      } catch (error) {
        /* fall through */
      }
    }
    const cached = cachedValues({ id: sessionId }, ['title']);
    return typeof cached.title === 'string' && cached.title.length > 0 ? cached.title : null;
  }

  /* --------------------------------------------------------- content read */

  async function readMessages(sessionId, limit) {
    const query = sessionQuery();
    if (!query || typeof query.readSurface !== 'function') throw new Error('sessionQuery service unavailable');
    const surface = await query.readSurface(sessionId);
    const events = (surface && surface.events) || [];
    const messages = [];
    for (const event of events) {
      if (!event || !event.data) continue;
      if (event.type === 'user/message') {
        const text = textOfContent(event.data.content);
        if (text.length > 0) messages.push({ role: 'user', text, at: event.time, turn: null });
      } else if (event.type === 'assistant/message') {
        const text = textOfContent(event.data.message && event.data.message.content);
        if (text.length > 0) messages.push({ role: 'assistant', text, at: event.time, turn: event.data.turn });
      }
    }
    return { messages, turns: countTurns(events), sampled: limit ? messages.slice(-limit) : messages };
  }

  function countTurns(events) {
    let turns = 0;
    for (const event of events) if (event && event.type === 'turn/start') turns += 1;
    return turns;
  }

  async function buildPayload(edge, sourceNode) {
    const fixedOutput = sourceNode && typeof sourceNode.output === 'string' ? sourceNode.output.trim() : '';
    if (fixedOutput.length > 0) return { text: truncate(fixedOutput), meta: '节点输出' };
    if (edge.kind === 'custom') {
      return { text: truncate((edge.text || '').trim()), meta: '自定义文本' };
    }
    const sourceId = edge.sourceSessionId;
    const query = sessionQuery();
    if (!query) throw new Error('sessionQuery service unavailable');
    if (edge.kind === 'summary') {
      const surface = await query.readSurface(sourceId);
      const events = (surface && surface.events) || [];
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event && event.type === 'assistant/message') {
          const text = textOfContent(event.data.message && event.data.message.content);
          if (text.length > 0) return { text: truncate(text), meta: '最后一轮回答' };
        }
      }
      return { text: '', meta: '最后一轮回答' };
    }
    const read = await readMessages(sourceId);
    const count = edge.kind === 'transcript' ? 0 : Math.max(1, edge.recentCount || 3) * 2;
    const selected = count > 0 ? read.messages.slice(-count) : read.messages;
    if (selected.length === 0) return { text: '', meta: edge.kind === 'transcript' ? '完整记录' : '最近几轮' };
    const body = selected
      .map((message) => (message.role === 'user' ? '【用户】' : '【助手】') + message.text)
      .join('\n\n');
    return { text: truncate(body), meta: edge.kind === 'transcript' ? '完整记录' : '最近 ' + Math.max(1, edge.recentCount || 3) + ' 轮' };
  }

  /* ------------------------------------------------------------ delivery */

  function recordTransfer(entry) {
    state.transfers.unshift(entry);
    if (state.transfers.length > MAX_TRANSFERS) state.transfers.length = MAX_TRANSFERS;
    schedulePersist();
  }

  async function transfer(edge, options = {}) {
    const agentService = agents();
    if (!agentService || typeof agentService.get !== 'function') {
      return { ok: false, code: 'no-agents', error: 'Agent service is unavailable in this profile.' };
    }
    const sourceSessionId = edge.sourceSessionId;
    const targetSessionId = edge.targetSessionId;
    if (!sourceSessionId || !targetSessionId) {
      return { ok: false, code: 'invalid-edge', error: 'edge endpoints are missing' };
    }
    const sourceNode = options.node || findNodeBySession(sourceSessionId);
    const cause = options.cause || (options.auto === true ? 'auto' : 'manual');
    const targetAgent = agentService.get(targetSessionId);
    const targetTitle = (await sessionTitle(targetSessionId)) || targetSessionId;
    const sourceTitle = (await sessionTitle(sourceSessionId)) || sourceSessionId;

    if (!targetAgent) {
      const failure = {
        id: randomUUID(),
        at: new Date().toISOString(),
        ok: false,
        reason: 'target-not-live',
        fromTitle: preview(sourceTitle, 40),
        toTitle: preview(targetTitle, 40),
        kind: edge.kind,
        kindLabel: edge.kind,
        chars: 0,
        auto: options.auto === true,
        cause,
      };
      recordTransfer(failure);
      return {
        ok: false,
        code: 'target-not-live',
        error: '目标对话「' + targetTitle + '」当前没有活动的 Agent：请先在 GUI 中打开该对话，再重试传输。',
      };
    }

    let payload;
    try {
      payload = await buildPayload({ ...edge, sourceSessionId }, sourceNode);
    } catch (error) {
      return { ok: false, code: 'read-failed', error: '读取源对话失败：' + (error && error.message ? error.message : String(error)) };
    }
    const text = (payload.text || '').trim();
    if (text.length === 0) {
      return { ok: false, code: 'empty-payload', error: '源对话中没有可传输的内容（' + payload.meta + '）。' };
    }

    const roleText = sourceNode && typeof sourceNode.role === 'string' ? sourceNode.role.trim() : '';
    const causeSuffix = cause === 'auto' ? '（自动协调）' : cause === 'schedule' ? '（定时触发）' : '';
    const header =
      '【对话流·' + payload.meta + '】来自对话「' + preview(sourceTitle, 40) + '」' +
      (roleText ? '·' + preview(roleText, 40) : '') +
      causeSuffix + '\n\n';
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: header + text }],
      source: { kind: 'user' },
    };

    try {
      targetAgent.followup(message);
    } catch (error) {
      const failure = {
        id: randomUUID(),
        at: new Date().toISOString(),
        ok: false,
        reason: 'delivery-failed',
        fromTitle: preview(sourceTitle, 40),
        toTitle: preview(targetTitle, 40),
        kind: edge.kind,
        kindLabel: payload.meta,
        chars: text.length,
        auto: options.auto === true,
        cause,
      };
      recordTransfer(failure);
      return { ok: false, code: 'delivery-failed', error: '投递失败：' + (error && error.message ? error.message : String(error)) };
    }

    if (cause !== 'manual') recentDeliveries.set(sourceSessionId + '->' + targetSessionId, Date.now());
    recordTransfer({
      id: randomUUID(),
      at: new Date().toISOString(),
      ok: true,
      fromTitle: preview(sourceTitle, 40),
      toTitle: preview(targetTitle, 40),
      kind: edge.kind,
      kindLabel: payload.meta,
      chars: text.length,
      auto: options.auto === true,
      cause,
    });
    return { ok: true, targetTitle: preview(targetTitle, 60), sourceTitle: preview(sourceTitle, 60), chars: text.length, kind: edge.kind, kindLabel: payload.meta };
  }

  /* ----------------------------------------------------- auto coordinate */

  function autoEdgesFor(sourceSessionId) {
    const nodeIds = new Set(
      (state.nodes || []).filter((node) => node.sessionId === sourceSessionId).map((node) => node.id),
    );
    if (nodeIds.size === 0) return [];
    return (state.edges || []).filter((edge) => edge.auto === true && nodeIds.has(edge.source));
  }

  function nodeSessionId(nodeId) {
    const node = (state.nodes || []).find((item) => item.id === nodeId);
    return node ? node.sessionId : null;
  }

  function findNodeBySession(sessionId) {
    return (state.nodes || []).find((node) => node.sessionId === sessionId) || null;
  }

  /** How long a node may stay "driven but unfinished" before another run is allowed. */
  const PENDING_TTL_MS = 10 * 60_000;

  /** The instruction a timed/manual execution delivers INTO the node's own conversation. */
  function nodeInstruction(node, options) {
    const role = (node.role || '').trim();
    const lines = ['【对话流·节点执行】你在画布中的职责：' + role];
    if (options && options.scheduled) {
      const every = node.schedule ? node.schedule.everyMinutes : 10;
      lines.push('（本次由定时任务触发，间隔 ' + every + ' 分钟）');
    }
    lines.push('');
    if (node.output && node.output.trim()) {
      lines.push('本次下发给下游的内容已固定，你只需按职责推进工作。');
    } else {
      lines.push('请按上述职责推进当前工作：完成后给出可交付的结论/结果，它会自动推送给下游节点。');
    }
    return lines.join('\n');
  }

  function nodeIsPending(node, now = Date.now()) {
    return !!node.pendingAt && now - node.pendingAt < PENDING_TTL_MS;
  }

  /** Push every outgoing channel of one node (fixed output or the conversation content). */
  async function pushNode(node, now) {
    const edges = (state.edges || []).filter((edge) => edge.source === node.id);
    let sent = 0;
    let failed = 0;
    for (const edge of edges) {
      const targetSessionId = nodeSessionId(edge.target);
      if (!targetSessionId) continue;
      // eslint-disable-next-line no-await-in-loop
      const result = await transfer(
        { ...edge, sourceSessionId: node.sessionId, targetSessionId },
        { cause: 'schedule', node },
      );
      if (result.ok) sent += 1;
      else {
        failed += 1;
        console.warn('[conversation-flow] node push skipped:', result.error);
      }
    }
    if (node.lastRunAt !== now) node.lastRunAt = now;
    schedulePersist();
    return { sent, failed };
  }

  /**
   * Execute a node — the real effect of its editable attributes:
   *  - `role` drives a turn in its own conversation (the agent is woken with the role
   *    as its instruction) and the downstream push waits for that turn to finish;
   *  - `output`, when set, is the pushed payload and can be delivered right away;
   *  - `schedule` decides when this happens automatically.
   */
  async function executeNode(node, options = {}) {
    const now = options.now || Date.now();
    const role = (node.role || '').trim();
    const hasOutput = !!(node.output && node.output.trim());
    const agentService = agents();

    if (!role || !agentService || typeof agentService.get !== 'function') {
      // No role: a pure data push (this is what the previous behaviour did).
      if (!(state.edges || []).some((edge) => edge.source === node.id)) {
        node.lastRunAt = now;
        schedulePersist();
        return { sent: 0, failed: 0, kicked: false };
      }
      const pushed = await pushNode(node, now);
      return { ...pushed, kicked: false };
    }

    const agent = agentService.get(node.sessionId);
    if (!agent) {
      return {
        sent: 0,
        failed: 0,
        kicked: false,
        error: '节点「' + (node.role || node.sessionId) + '」的对话当前没有活动的 Agent：请先在 GUI 打开它，再重试执行。',
      };
    }

    node.lastRunAt = now;
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: nodeInstruction(node, options) }],
      source: { kind: 'user' },
    };
    try {
      agent.followup(message);
    } catch (error) {
      return {
        sent: 0,
        failed: 0,
        kicked: false,
        error: '驱动节点对话失败：' + (error && error.message ? error.message : String(error)),
      };
    }

    if (hasOutput) {
      // Deterministic payload — no need to wait for the turn.
      node.pendingAt = 0;
      const pushed = await pushNode(node, now);
      return { ...pushed, kicked: true, pending: false };
    }

    node.pendingAt = now;
    schedulePersist();
    return { sent: 0, failed: 0, kicked: true, pending: true };
  }

  /** The driven turn finished: deliver its fresh result downstream (exactly once). */
  async function fulfilPending(sessionId) {
    const now = Date.now();
    const nodes = (state.nodes || []).filter(
      (node) => node.sessionId === sessionId && node.pendingAt && now - node.pendingAt < PENDING_TTL_MS,
    );
    for (const node of nodes) {
      node.pendingAt = 0;
      // eslint-disable-next-line no-await-in-loop
      await pushNode(node, now);
    }
  }

  /** One scheduler pass: every timed node whose window elapsed is executed. */
  async function runScheduled(now = Date.now()) {
    for (const node of state.nodes || []) {
      const schedule = node.schedule;
      if (!schedule || schedule.enabled !== true) continue;
      const intervalMs = Math.max(MIN_SCHEDULE_MINUTES, schedule.everyMinutes || 10) * 60_000;
      if (now - (node.lastRunAt || 0) < intervalMs) continue;
      if (nodeIsPending(node, now)) continue;
      if (!(state.edges || []).some((edge) => edge.source === node.id)) continue;
      // eslint-disable-next-line no-await-in-loop
      const outcome = await executeNode(node, { now, scheduled: true });
      if (outcome && outcome.error) console.warn('[conversation-flow] scheduled node skipped:', outcome.error);
    }
  }

  async function coordinateFrom(sourceSessionId, auto) {
    const edges = autoEdgesFor(sourceSessionId);
    if (edges.length === 0) return;
    const now = Date.now();
    for (const edge of edges) {
      const targetSessionId = nodeSessionId(edge.target);
      if (!targetSessionId) continue;
      const guardKey = sourceSessionId + '->' + targetSessionId;
      const last = recentDeliveries.get(guardKey) || 0;
      if (now - last < LOOP_GUARD_MS) continue;
      // eslint-disable-next-line no-await-in-loop
      const result = await transfer({ ...edge, sourceSessionId, targetSessionId }, { auto: auto === true, cause: 'auto' });
      if (!result.ok) console.warn('[conversation-flow] auto transfer skipped:', result.error);
    }
  }

  /* ------------------------------------------------------------- effects */

  const disposers = [];

  // Auto-coordination trigger: a durably committed turn boundary.
  disposers.push(
    ctx.on('session/event', (session, event) => {
      if (!session || !event) return;
      if (event.type !== 'turn/end') return;
      if (!event.data || !event.data.reason || event.data.reason.kind !== 'completed') return;
      const sessionId = session.id;
      ensureLoaded()
        .then(async () => {
          // A driven node delivers its own result first, so the shared loop guard
          // suppresses a duplicate auto-coordination push for the same target.
          await fulfilPending(sessionId);
          await coordinateFrom(sessionId, true);
        })
        .catch((error) => console.error('[conversation-flow] coordination failed:', error && error.message ? error.message : error));
    }),
  );

  // Timed nodes: a single ticker drives every `schedule.enabled` node.
  const tickMs = Math.min(300_000, Math.max(20, Number(config && config.schedulerIntervalMs) || 20_000));
  const schedulerTimer = setInterval(() => {
    runScheduled().catch((error) =>
      console.error('[conversation-flow] scheduled run failed:', error && error.message ? error.message : error),
    );
  }, tickMs);
  if (typeof schedulerTimer.unref === 'function') schedulerTimer.unref();
  disposers.push(() => clearInterval(schedulerTimer));

  const server = webServer();
  if (server && typeof server.register === 'function') {
    disposers.push(
      server.register({
        kind: 'prefix',
        path: GRAPH_ROUTE,
        handler: async (req, res) => {
          const json = (status, value) => {
            res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(value));
          };
          try {
            // Light request policy: this route is not covered by the app's /api auth.
            const site = req.headers['sec-fetch-site'];
            if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
              json(403, { ok: false, error: 'cross-site request refused' });
              return;
            }
            await ensureLoaded();
            const url = new URL(req.url || '/', 'http://localhost');
            const route = url.pathname.slice(GRAPH_ROUTE.length);
            const method = (req.method || 'GET').toUpperCase();

            if (method === 'GET' && (route === '/api/state' || route === '/api/state/')) {
              const sessions = await listSessions();
              json(200, {
                ok: true,
                value: {
                  rev: state.rev,
                  graph: { nodes: state.nodes, edges: state.edges, canvas: state.canvas },
                  transfers: state.transfers,
                  sessions,
                  panelId: 'conversation-flow',
                  storedAt: stateFile(),
                  diagnostics: {
                    tool: toolRegistration.status,
                    toolError: toolRegistration.error,
                    route: GRAPH_ROUTE,
                  },
                },
              });
              return;
            }

            if (method === 'POST' && (route === '/api/graph' || route === '/api/graph/')) {
              const body = await readJsonBody(req);
              const graph = normalizeGraph(body);
              state.nodes = graph.nodes;
              state.edges = graph.edges;
              if (body && body.canvas !== undefined) state.canvas = graph.canvas;
              await persist();
              json(200, { ok: true, value: { rev: state.rev, nodes: state.nodes.length, edges: state.edges.length, canvas: state.canvas } });
              return;
            }

            if (method === 'POST' && (route === '/api/node' || route === '/api/node/')) {
              const body = await readJsonBody(req);
              const node = (state.nodes || []).find(
                (item) =>
                  (typeof body.nodeId === 'string' && item.id === body.nodeId) ||
                  (typeof body.sessionId === 'string' && item.sessionId === body.sessionId),
              );
              if (!node) {
                json(404, { ok: false, error: '节点不在画布上：' + String(body.nodeId || body.sessionId || '') });
                return;
              }
              if (typeof body.role === 'string') node.role = body.role.slice(0, MAX_ROLE_CHARS);
              if (typeof body.output === 'string') node.output = body.output.slice(0, MAX_PAYLOAD_CHARS);
              if (body.schedule && typeof body.schedule === 'object') {
                node.schedule = normalizeSchedule({ ...node.schedule, ...body.schedule });
              }
              await persist();
              json(200, { ok: true, value: node });
              return;
            }

            if (method === 'POST' && (route === '/api/run' || route === '/api/run/')) {
              const body = await readJsonBody(req);
              const node = (state.nodes || []).find(
                (item) =>
                  (typeof body.nodeId === 'string' && item.id === body.nodeId) ||
                  (typeof body.sessionId === 'string' && item.sessionId === body.sessionId),
              );
              if (!node) {
                json(404, { ok: false, error: '节点不在画布上：' + String(body.nodeId || body.sessionId || '') });
                return;
              }
              const outcome = await executeNode(node);
              json(200, {
                ok: true,
                value: { nodeId: node.id, lastRunAt: node.lastRunAt, pendingAt: node.pendingAt || 0, ...outcome },
              });
              return;
            }

            if (method === 'POST' && (route === '/api/transfer' || route === '/api/transfer/')) {
              const body = await readJsonBody(req);
              const edge = {
                kind: ['summary', 'recent', 'transcript', 'custom'].includes(body.kind) ? body.kind : 'summary',
                text: typeof body.text === 'string' ? body.text : '',
                recentCount: Number.isFinite(body.recentCount) ? body.recentCount : 3,
                sourceSessionId: nodeSessionId(body.source) || (typeof body.source === 'string' ? body.source : null),
                targetSessionId: nodeSessionId(body.target) || (typeof body.target === 'string' ? body.target : null),
              };
              const result = await transfer(edge, { auto: false });
              json(result.ok ? 200 : 409, result.ok ? { ok: true, value: result } : { ok: false, error: result.error, code: result.code });
              return;
            }

            if (method === 'POST' && (route === '/api/coordinate' || route === '/api/coordinate/')) {
              const body = await readJsonBody(req);
              const edge = (state.edges || []).find((item) => item.id === body.edgeId);
              if (!edge) {
                json(404, { ok: false, error: 'edge not found' });
                return;
              }
              edge.auto = body.enabled !== false;
              await persist();
              json(200, { ok: true, value: { edgeId: edge.id, auto: edge.auto } });
              return;
            }

            json(404, { ok: false, error: 'unknown route' });
          } catch (error) {
            try {
              json(500, { ok: false, error: error && error.message ? error.message : String(error) });
            } catch (writeError) {
              /* response already finished */
            }
          }
        },
      }),
    );
  } else {
    console.warn('[conversation-flow] webServer service unavailable: the console panel will report Host offline');
  }

  // Agent-facing twin of the panel operations.
  const tools = ctx.get('tools');
  if (tools && typeof tools.register === 'function') {
    toolRegistration.status = 'attempting';
    try {
      disposers.push(
        tools.register({
          name: 'conversation_flow',
          description:
            '管理「对话流」画布：列出所有对话及其状态，查看画布上的节点与数据通道，编辑节点的作用/输出内容/定时，在对话之间搬运内容（摘要/最近几轮/完整记录/自定义文本），以及开启或关闭自动协调（源对话每轮结束时自动把内容推送到目标对话）。数据只会投递给当前已打开（有活动 Agent）的对话。',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'state', 'node', 'run', 'transfer', 'coordinate', 'link'],
                description: 'list：列出对话；state：查看画布；node：编辑节点的作用/输出/定时；run：立即按定时逻辑推送该节点的下游；transfer：把内容从源对话推到目标对话；coordinate：开关某条连线的自动协调；link：在画布上建立一条数据通道。',
              },
              source: { type: 'string', description: '源对话的 session id，或它在画布上的节点 id。transfer/link 必填。' },
              target: { type: 'string', description: '目标对话的 session id，或它在画布上的节点 id。transfer/link 必填。' },
              kind: { type: 'string', enum: ['summary', 'recent', 'transcript', 'custom'], description: '传输内容类型，默认 summary（最后一轮回答）。' },
              text: { type: 'string', description: 'kind=custom 时要推送的文本。' },
              recent_count: { type: 'number', description: 'kind=recent 时的轮数，默认 3。' },
              auto: { type: 'boolean', description: 'link 时是否开启自动协调；coordinate 时为目标开关。' },
              edge_id: { type: 'string', description: 'coordinate 时要修改的连线 id。' },
              node_id: { type: 'string', description: 'node/run 的目标节点 id（也可用 source 传 session id）。' },
              role: { type: 'string', description: 'node：节点作用（≤200 字）。' },
              output: { type: 'string', description: 'node：输出内容；填写后该节点总是推送这段文本，留空则按连线类型从对话取内容。' },
              schedule: { type: 'boolean', description: 'node：是否定时。' },
              every_minutes: { type: 'number', description: 'node：定时间隔（分钟，1–720）。' },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
          },
          async execute(args, exec) {
            await ensureLoaded();
            const action = args && args.action;
            if (action === 'list') {
              const sessions = await listSessions();
              if (sessions.length === 0) return '当前没有可见对话。';
              return sessions
                .map(
                  (session, index) =>
                    index +
                    1 +
                    '. ' +
                    session.title +
                    ' — ' +
                    (session.busy ? '运行中' : session.live ? '已打开' : '未打开') +
                    ' · ' +
                    session.turns +
                    ' 轮 · ' +
                    session.updatedText +
                    ' · id=' +
                    session.id,
                )
                .join('\n');
            }
            if (action === 'state') {
              if (state.nodes.length === 0) return '画布为空。';
              const lines = state.nodes.map((node) => {
                const bits = ['· 节点 ' + node.id + ' → 对话 ' + node.sessionId];
                if (node.role) bits.push('作用：' + node.role);
                if (node.output) bits.push('输出：固定文本 ' + node.output.length + ' 字');
                if (node.schedule && node.schedule.enabled) {
                  bits.push('定时：每 ' + node.schedule.everyMinutes + ' 分钟');
                  if (node.lastRunAt) bits.push('上次 ' + new Date(node.lastRunAt).toLocaleString());
                } else {
                  bits.push('定时：关');
                }
                if (node.pendingAt && Date.now() - node.pendingAt < PENDING_TTL_MS) bits.push('执行中（等待该轮产出）');
                return bits.join(' · ');
              });
              const edges = state.edges.map(
                (edge) =>
                  '· 通道 ' + edge.id + '：' + edge.source + ' → ' + edge.target + '（' + edge.kind + (edge.auto ? '，自动协调' : '，手动') + '）',
              );
              const recent = state.transfers.slice(0, 5).map((item) => '· ' + item.at + ' ' + (item.ok ? '成功' : '失败') + '：' + item.fromTitle + ' → ' + item.toTitle + '（' + item.chars + ' 字）');
              return [lines.join('\n'), edges.join('\n'), recent.join('\n')].filter(Boolean).join('\n\n');
            }
            if (action === 'node') {
              const key = args.node_id || args.source;
              const node =
                (state.nodes || []).find((item) => item.id === key) ||
                (state.nodes || []).find((item) => item.sessionId === key);
              if (!node) return '未找到节点 ' + String(key) + '。';
              if (typeof args.role === 'string') node.role = args.role.slice(0, MAX_ROLE_CHARS);
              if (typeof args.output === 'string') node.output = args.output.slice(0, MAX_PAYLOAD_CHARS);
              if (typeof args.schedule === 'boolean' || Number.isFinite(args.every_minutes)) {
                node.schedule = normalizeSchedule({
                  ...node.schedule,
                  ...(typeof args.schedule === 'boolean' ? { enabled: args.schedule } : {}),
                  ...(Number.isFinite(args.every_minutes) ? { everyMinutes: args.every_minutes } : {}),
                });
              }
              await persist();
              const parts = ['节点 ' + node.id + '（对话 ' + node.sessionId + '）已更新'];
              parts.push('作用：' + (node.role || '（空）'));
              parts.push('输出：' + (node.output ? '固定 ' + node.output.length + ' 字' : '按连线类型取对话内容'));
              parts.push(
                '定时：' +
                  (node.schedule.enabled ? '每 ' + node.schedule.everyMinutes + ' 分钟' : '关'),
              );
              return parts.join('；') + '。';
            }
            if (action === 'run') {
              const key = args.node_id || args.source;
              const node =
                (state.nodes || []).find((item) => item.id === key) ||
                (state.nodes || []).find((item) => item.sessionId === key);
              if (!node) return '未找到节点 ' + String(key) + '。';
              const outcome = await executeNode(node);
              if (outcome.error) return '执行失败：' + outcome.error;
              if (outcome.kicked && outcome.pending) {
                return (
                  '节点 ' + node.id + ' 已按其职责驱动对话「' + node.sessionId + '」，' +
                  '该轮结束后会把结果推给下游通道。'
                );
              }
              if (outcome.kicked) {
                return '节点 ' + node.id + ' 已驱动对话并推送固定输出：成功 ' + outcome.sent + ' 条' + (outcome.failed ? '，失败 ' + outcome.failed + ' 条' : '') + '。';
              }
              if (outcome.sent === 0 && outcome.failed === 0) return '节点 ' + node.id + ' 没有下游通道，未推送。';
              return '节点 ' + node.id + ' 已推送：成功 ' + outcome.sent + ' 条' + (outcome.failed ? '，失败 ' + outcome.failed + ' 条' : '') + '。';
            }
            if (action === 'transfer') {
              const sourceSessionId = nodeSessionId(args.source) || args.source;
              const targetSessionId = nodeSessionId(args.target) || args.target;
              if (!sourceSessionId || !targetSessionId) return 'transfer 需要 source 与 target。';
              const result = await transfer(
                {
                  kind: args.kind || 'summary',
                  text: args.text || '',
                  recentCount: Number.isFinite(args.recent_count) ? args.recent_count : 3,
                  sourceSessionId,
                  targetSessionId,
                },
                { auto: false },
              );
              if (!result.ok) return '传输失败：' + result.error;
              return '已把 ' + result.chars + ' 字从「' + result.sourceTitle + '」推送至「' + result.targetTitle + '」。';
            }
            if (action === 'link') {
              const sourceSessionId = nodeSessionId(args.source) || args.source;
              const targetSessionId = nodeSessionId(args.target) || args.target;
              if (!sourceSessionId || !targetSessionId) return 'link 需要 source 与 target。';
              const ensureNode = (sessionId) => {
                const existing = state.nodes.find((node) => node.sessionId === sessionId);
                if (existing) return existing;
                const node = { id: 'n' + randomUUID().slice(0, 8), sessionId, x: 40 + state.nodes.length * 40, y: 40 + state.nodes.length * 30 };
                state.nodes.push(node);
                return node;
              };
              const sourceNode = ensureNode(sourceSessionId);
              const targetNode = ensureNode(targetSessionId);
              if (sourceNode.id === targetNode.id) return '不能把对话连接到它自己。';
              const existing = state.edges.find((edge) => edge.source === sourceNode.id && edge.target === targetNode.id);
              if (existing) {
                existing.auto = args.auto === true;
                await persist();
                return '已更新通道 ' + existing.id + '（自动协调：' + (existing.auto ? '开' : '关') + '）。';
              }
              const edge = {
                id: 'e' + randomUUID().slice(0, 8),
                source: sourceNode.id,
                target: targetNode.id,
                kind: args.kind || 'summary',
                auto: args.auto === true,
                text: args.text || '',
                recentCount: Number.isFinite(args.recent_count) ? args.recent_count : 3,
              };
              state.edges.push(edge);
              await persist();
              return '已建立通道 ' + edge.id + '：' + sourceSessionId + ' → ' + targetSessionId + '。';
            }
            if (action === 'coordinate') {
              const edge = state.edges.find((item) => item.id === args.edge_id);
              if (!edge) return '未找到连线 ' + args.edge_id + '。';
              edge.auto = args.auto !== false;
              await persist();
              return '连线 ' + edge.id + ' 的自动协调已' + (edge.auto ? '开启' : '关闭') + '。';
            }
            return '未知 action：' + String(action);
          },
        }),
      );
      toolRegistration.status = 'registered';
    } catch (error) {
      toolRegistration.status = 'failed';
      toolRegistration.error = error && error.message ? error.message : String(error);
      console.error('[conversation-flow] tool registration failed:', toolRegistration.error);
    }
  } else {
    toolRegistration.status = 'no-service';
  }

  ctx.effect(() => () => {
    if (saveTimer) clearTimeout(saveTimer);
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        /* ignore teardown races */
      }
    }
    persist().catch(() => {});
  }, 'conversation-flow: routes, listeners and tool');
}
