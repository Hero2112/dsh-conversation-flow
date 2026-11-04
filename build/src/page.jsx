import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
} from '@xyflow/react';
import flowCss from '@xyflow/react/dist/style.css';
import { MESSAGES, TOKENS, api, readLocaleId, translate } from './shared.js';

const MINI = { padding: 0, margin: 0 };

const NODE_WIDTH = 236;

/* ------------------------------------------------------------------ styles */

function flowStyles(t) {
  return `
.cf-root { font-family: ${t.font}; color: ${t.text}; }
.cf-root .react-flow { background: ${t.bg}; }
.cf-root .react-flow__edge-path { stroke: ${t.textFaint}; stroke-width: 1.6; }
.cf-root .react-flow__edge.selected .react-flow__edge-path,
.cf-root .react-flow__edge:focus .react-flow__edge-path { stroke: ${t.accent}; stroke-width: 2.2; }
.cf-root .react-flow__edge.cf-auto .react-flow__edge-path { stroke: ${t.accent}; stroke-dasharray: 6 4; }
.cf-root .react-flow__edge-text { fill: ${t.textMuted}; font-size: 10px; }
.cf-root .react-flow__edge-textbg { fill: ${t.surface}; }
.cf-root .react-flow__controls { box-shadow: none; border: 1px solid ${t.border}; border-radius: ${t.radiusSm}; overflow: hidden; }
.cf-root .react-flow__controls-button { background: ${t.surface}; border-bottom: 1px solid ${t.border}; color: ${t.text}; fill: ${t.text}; }
.cf-root .react-flow__controls-button:hover { background: ${t.surfaceHover}; }
.cf-root .react-flow__minimap { background: ${t.surface}; border: 1px solid ${t.border}; border-radius: ${t.radiusSm}; }
.cf-root .react-flow__attribution { display: none; }
.cf-node { width: ${NODE_WIDTH}px; background: ${t.surface}; border: 1px solid ${t.border}; border-radius: ${t.radius}; box-shadow: 0 8px 24px rgba(0,0,0,.28); color: ${t.text}; font-family: ${t.font}; }
.cf-node.is-selected { border-color: ${t.accent}; box-shadow: 0 0 0 1px ${t.accent}, 0 10px 28px rgba(0,0,0,.34); }
.cf-node-head { display: flex; align-items: center; gap: 6px; padding: 9px 10px 6px; }
.cf-dot { width: 7px; height: 7px; border-radius: 50%; background: ${t.textFaint}; flex: none; }
.cf-dot.live { background: ${t.success}; box-shadow: 0 0 0 3px rgba(63,191,127,.16); }
.cf-dot.busy { background: ${t.warning}; box-shadow: 0 0 0 3px rgba(224,161,61,.18); }
.cf-node-title { font-size: 12.5px; font-weight: 600; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cf-node-body { padding: 0 10px 8px; }
.cf-node-meta { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: ${t.textFaint}; margin-bottom: 6px; }
.cf-node-preview { font-size: 11px; line-height: 1.45; color: ${t.textMuted}; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-height: 15px; }
.cf-node-role { font-size: 10.5px; line-height: 1.35; color: ${t.accent}; margin: -2px 0 5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cf-node-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.cf-badge { font-size: 9.5px; line-height: 1; padding: 3px 5px; border-radius: 999px; border: 1px solid ${t.border}; background: ${t.surfaceMuted}; color: ${t.textMuted}; }
.cf-badge.schedule { border-color: ${t.accent}; color: ${t.accent}; }
.cf-badge.output { border-color: ${t.borderStrong}; }
.cf-node-foot { display: flex; gap: 4px; padding: 6px 8px 8px; border-top: 1px solid ${t.border}; }
.cf-btn { font: inherit; font-size: 10.5px; line-height: 1; padding: 5px 7px; border-radius: ${t.radiusSm}; border: 1px solid ${t.border}; background: ${t.surfaceMuted}; color: ${t.textMuted}; cursor: pointer; white-space: nowrap; }
.cf-btn:hover { background: ${t.surfaceHover}; color: ${t.text}; }
.cf-btn.primary { background: ${t.accentSoft}; border-color: ${t.accent}; color: ${t.text}; }
.cf-btn.danger:hover { border-color: ${t.danger}; color: ${t.danger}; }
.cf-btn:disabled { opacity: .5; cursor: default; }
.cf-handle { width: 8px; height: 8px; border-radius: 50%; background: ${t.surface}; border: 1.5px solid ${t.textFaint}; }
.cf-handle:hover { border-color: ${t.accent}; background: ${t.accent}; }
.cf-canvas-tools { position: absolute; top: 10px; right: 10px; z-index: 20; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.cf-canvas-panel { width: 218px; padding: 10px 11px 11px; border-radius: ${t.radius}; border: 1px solid ${t.border}; background: ${t.surface}; box-shadow: 0 12px 28px rgba(0,0,0,.32); font-family: ${t.font}; color: ${t.text}; }
.cf-canvas-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 9px; }
.cf-canvas-row:first-child { margin-top: 0; }
.cf-canvas-label { font-size: 10.5px; color: ${t.textMuted}; letter-spacing: .02em; }
.cf-swatches { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.cf-swatch { width: 20px; height: 20px; border-radius: 5px; border: 1px solid ${t.borderStrong}; cursor: pointer; padding: 0; position: relative; }
.cf-swatch.is-active { outline: 2px solid ${t.accent}; outline-offset: 1px; }
.cf-swatch.theme { display: flex; align-items: center; justify-content: center; font-size: 10px; color: ${t.textMuted}; background: linear-gradient(135deg, ${t.surface} 50%, ${t.bg} 50%); }
.cf-color { width: 34px; height: 20px; padding: 0; border: 1px solid ${t.borderStrong}; border-radius: 5px; background: transparent; cursor: pointer; }
.cf-canvas-panel select { font: inherit; font-size: 10.5px; padding: 3px 5px; border-radius: ${t.radiusSm}; border: 1px solid ${t.border}; background: ${t.surfaceMuted}; color: ${t.text}; cursor: pointer; }
.cf-canvas-panel .cf-btn { font-size: 10.5px; }
.cf-canvas-panel .cf-btn.is-on { background: ${t.accentSoft}; border-color: ${t.accent}; color: ${t.text}; }
.cf-field { font: inherit; font-size: 11.5px; color: ${t.text}; background: ${t.surfaceMuted}; border: 1px solid ${t.border}; border-radius: ${t.radiusSm}; padding: 6px 8px; outline: none; width: 100%; box-sizing: border-box; }
.cf-field:focus { border-color: ${t.accent}; }
.cf-field::placeholder { color: ${t.textFaint}; }
.cf-num { width: 64px; font: inherit; font-size: 11.5px; text-align: right; padding: 4px 6px; border-radius: ${t.radiusSm}; border: 1px solid ${t.border}; background: ${t.surfaceMuted}; color: ${t.text}; outline: none; }
.cf-num:focus { border-color: ${t.accent}; }
.cf-topic-select { font: inherit; font-size: 11.5px; padding: 4px 7px; border-radius: ${t.radiusSm}; border: 1px solid ${t.borderStrong}; background: ${t.surface}; color: ${t.text}; cursor: pointer; max-width: 260px; }
.cf-topicbar .cf-field { font-size: 11.5px; }
`;
}

/* -------------------------------------------------------------------- i18n */

function useMessages(ctx) {
  const [localeId, setLocaleId] = useState(() => {
    const locale = ctx && ctx.get ? ctx.get('locale') : undefined;
    return readLocaleId(locale && typeof locale.getLocale === 'function' ? locale.getLocale() : undefined);
  });
  useEffect(() => {
    const locale = ctx && ctx.get ? ctx.get('locale') : undefined;
    if (!locale || typeof locale.subscribe !== 'function') return undefined;
    const sync = () =>
      setLocaleId(readLocaleId(typeof locale.getLocale === 'function' ? locale.getLocale() : undefined));
    sync();
    return locale.subscribe(sync);
  }, [ctx]);
  // The page reads messages as properties (`t.title`), so expose a resolved
  // dictionary for the active locale with the Chinese table as the base.
  return useMemo(() => {
    const dictionary = Object.assign({}, MESSAGES.zh, MESSAGES[localeId] || {});
    const resolve = (key) => (dictionary[key] != null ? dictionary[key] : key);
    const messages = {};
    for (const key of Object.keys(dictionary)) messages[key] = resolve(key);
    return messages;
  }, [localeId]);
}

/* ------------------------------------------------------------------- nodes */

function ConversationNode({ data, selected }) {
  const state = data.busy ? 'busy' : data.live ? 'live' : '';
  const statusText = data.busy ? data.t.busy : data.live ? data.t.live : data.t.noAgent;
  return (
    <div className={'cf-node' + (selected ? ' is-selected' : '')}>
      <Handle type="target" position={Position.Left} className="cf-handle" />
      <div className="cf-node-head">
        <span className={'cf-dot ' + state} />
        <span className="cf-node-title" title={data.title}>{data.title}</span>
      </div>
      <div className="cf-node-body">
        {data.role ? <div className="cf-node-role" title={data.role}>{data.role}</div> : null}
        <div className="cf-node-meta">
          <span>{statusText}</span>
          {data.turns > 0 ? <><span>·</span><span>{data.turns} {data.t.round}</span></> : null}
          {data.updated ? <><span>·</span><span>{data.updated}</span></> : null}
        </div>
        <div className="cf-node-preview">{data.preview || data.t.empty}</div>
        {data.scheduleOn || data.hasOutput || data.pending ? (
          <div className="cf-node-badges">
            {data.pending ? <span className="cf-badge schedule">⏳ {data.t.nodeExecuting}</span> : null}
            {data.scheduleOn ? (
              <span className="cf-badge schedule">⏱ {data.t.everyMinutes} {data.scheduleMinutes} {data.t.minutesUnit}</span>
            ) : null}
            {data.hasOutput ? <span className="cf-badge output">✎ {data.t.nodeOutput}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="cf-node-foot">
        <button type="button" className="cf-btn" onClick={data.onOpen}>{data.t.open}</button>
        <button type="button" className="cf-btn primary" disabled={!data.outCount} onClick={data.onSend}>
          {data.t.send}{data.outCount ? ' (' + data.outCount + ')' : ''}
        </button>
        <button type="button" className="cf-btn danger" onClick={data.onRemove}>×</button>
      </div>
      <Handle type="source" position={Position.Right} className="cf-handle" />
    </div>
  );
}

const NODE_TYPES = { conversation: ConversationNode };

/* ---------------------------------------------------------------- controls */

function Rail({ t, sessions, onAdd, onOpen, canvasSessionIds }) {
  const [query, setQuery] = useState('');
  const items = sessions.filter((s) => {
    if (!query) return true;
    return (s.title || '').toLowerCase().includes(query.toLowerCase());
  });
  return (
    <aside style={{ borderRight: '1px solid ' + TOKENS.border, display: 'flex', flexDirection: 'column', minWidth: 0, background: TOKENS.surface }}>
      <div style={{ padding: '10px 12px 6px', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint }}>
        {t.sessions} · {sessions.length}
      </div>
      <div style={{ padding: '0 10px 8px' }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.search}
          style={{
            width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 11.5, color: TOKENS.text,
            background: TOKENS.surfaceMuted, border: '1px solid ' + TOKENS.border, borderRadius: TOKENS.radiusSm,
            padding: '6px 8px', outline: 'none',
          }}
        />
      </div>
      <div style={{ overflow: 'auto', flex: 1, padding: '0 6px 10px' }}>
        {items.length === 0 ? (
          <div style={{ padding: '14px 8px', fontSize: 11.5, color: TOKENS.textFaint }}>{t.emptyList}</div>
        ) : null}
        {items.map((session) => {
          const onCanvas = canvasSessionIds.has(session.id);
          return (
            <div
              key={session.id}
              onClick={() => (onCanvas ? onOpen(session) : onAdd(session))}
              title={session.title}
              style={{
                display: 'flex', flexDirection: 'column', gap: 2, padding: '7px 8px', margin: '1px 0',
                borderRadius: TOKENS.radiusSm, cursor: 'pointer', border: '1px solid transparent',
                opacity: onCanvas ? 0.55 : 1,
              }}
              onMouseEnter={(event) => { event.currentTarget.style.background = TOKENS.surfaceHover; event.currentTarget.style.borderColor = TOKENS.border; }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.borderColor = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, flex: 'none', background: session.busy ? TOKENS.warning : session.live ? TOKENS.success : TOKENS.textFaint }} />
                <span style={{ fontSize: 12, color: TOKENS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title || session.id}</span>
              </div>
              <div style={{ fontSize: 10.5, color: TOKENS.textFaint, paddingLeft: 12, display: 'flex', gap: 6 }}>
                <span>{onCanvas ? t.onCanvas : t.addNode}</span>
                {session.turns > 0 ? <><span>·</span><span>{session.turns} {t.round}</span></> : null}
                {session.updatedText ? <><span>·</span><span>{session.updatedText}</span></> : null}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
      <span style={{ fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint }}>{label}</span>
      {children}
    </label>
  );
}

function selectStyle() {
  return {
    font: 'inherit', fontSize: 12, color: TOKENS.text, background: TOKENS.surfaceMuted,
    border: '1px solid ' + TOKENS.border, borderRadius: TOKENS.radiusSm, padding: '6px 8px', outline: 'none',
  };
}

function Inspector({ t, edge, edgeSource, edgeTarget, onChange, onTransfer, onDelete, busy, transferError }) {
  if (!edge) {
    return (
      <aside style={{ borderLeft: '1px solid ' + TOKENS.border, padding: 14, background: TOKENS.surface, fontSize: 11.5, color: TOKENS.textFaint, lineHeight: 1.6 }}>
        <div style={{ fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint, marginBottom: 10 }}>{t.inspector}</div>
        {t.noSelection}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid ' + TOKENS.border }}>{t.canvasHint}</div>
      </aside>
    );
  }
  return (
    <aside style={{ borderLeft: '1px solid ' + TOKENS.border, padding: 14, background: TOKENS.surface, overflow: 'auto' }}>
      <div style={{ fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint, marginBottom: 10 }}>{t.inspector}</div>
      <div style={{ fontSize: 11.5, color: TOKENS.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        <div>{t.source}: <span style={{ color: TOKENS.text }}>{edgeSource}</span></div>
        <div>{t.target}: <span style={{ color: TOKENS.text }}>{edgeTarget}</span></div>
      </div>
      <Field label={t.payloadKind}>
        <select value={edge.kind} onChange={(event) => onChange({ kind: event.target.value })} style={selectStyle()}>
          <option value="summary">{t.kindSummary}</option>
          <option value="recent">{t.kindRecent}</option>
          <option value="transcript">{t.kindTranscript}</option>
          <option value="custom">{t.kindCustom}</option>
        </select>
      </Field>
      {edge.kind === 'recent' ? (
        <Field label={t.recentCount}>
          <input
            type="number" min="1" max="20" value={edge.recentCount || 3}
            onChange={(event) => onChange({ recentCount: Number(event.target.value) || 3 })}
            style={selectStyle()}
          />
        </Field>
      ) : null}
      {edge.kind === 'custom' ? (
        <Field label={t.payload}>
          <textarea
            value={edge.text || ''} placeholder={t.customPlaceholder} rows={5}
            onChange={(event) => onChange({ text: event.target.value })}
            style={{ ...selectStyle(), resize: 'vertical', lineHeight: 1.5 }}
          />
        </Field>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0 12px', borderTop: '1px solid ' + TOKENS.border }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: TOKENS.text }}>{edge.auto ? t.autoOn : t.autoOff}</div>
          <div style={{ fontSize: 10.5, color: TOKENS.textFaint, lineHeight: 1.4 }}>{edge.auto ? t.autoHint : t.manualHint}</div>
        </div>
        <button
          type="button"
          onClick={() => onChange({ auto: !edge.auto })}
          role="switch"
          aria-checked={edge.auto ? 'true' : 'false'}
          style={{
            flex: 'none', width: 38, height: 21, borderRadius: 11, border: '1px solid ' + (edge.auto ? TOKENS.accent : TOKENS.borderStrong),
            background: edge.auto ? TOKENS.accent : TOKENS.surfaceMuted, cursor: 'pointer', position: 'relative', padding: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 2, left: edge.auto ? 19 : 2, width: 15, height: 15, borderRadius: 8,
            background: '#fff', transition: 'left .16s ease',
          }} />
        </button>
      </div>
      {transferError ? (
        <div style={{ fontSize: 11, color: TOKENS.danger, marginBottom: 10, lineHeight: 1.5 }}>{transferError}</div>
      ) : null}
      <button type="button" className="cf-btn primary" style={{ width: '100%', padding: '8px 10px', fontSize: 12 }} disabled={busy} onClick={onTransfer}>
        {busy ? t.transferring : t.transferNow}
      </button>
      <button type="button" className="cf-btn danger" style={{ width: '100%', padding: '7px 10px', fontSize: 11.5, marginTop: 8 }} onClick={onDelete}>
        {t.deleteEdge}
      </button>
    </aside>
  );
}

/* ---------------------------------------------------------------- node form */

function NodeInspector({ t, node, sessionTitle, busy, onPatch, onRun, onRemove }) {
  const [role, setRole] = useState(node.role || '');
  const [output, setOutput] = useState(node.output || '');
  const [minutes, setMinutes] = useState(node.schedule ? node.schedule.everyMinutes : 10);
  const saveTimer = useRef(null);

  /* Re-seed the drafts only when another node is selected, so a poll refresh
     cannot erase text that is being typed. */
  useEffect(() => {
    setRole(node.role || '');
    setOutput(node.output || '');
    setMinutes(node.schedule ? node.schedule.everyMinutes : 10);
  }, [node.id]);

  const queue = useCallback(
    (patch) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => onPatch(patch), 450);
    },
    [onPatch],
  );
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const schedule = node.schedule || { enabled: false, everyMinutes: 10 };
  const isOn = schedule.enabled === true;

  return (
    <aside style={{ borderLeft: '1px solid ' + TOKENS.border, padding: 14, background: TOKENS.surface, overflow: 'auto', fontSize: 11.5, color: TOKENS.textMuted, lineHeight: 1.6 }}>
      <div style={{ fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint, marginBottom: 4 }}>
        {t.nodeSettings}
      </div>
      <div style={{ fontSize: 12.5, color: TOKENS.text, marginBottom: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sessionTitle}>
        {sessionTitle}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint }}>{t.nodeRole}</span>
        <input
          className="cf-field"
          value={role}
          placeholder={t.nodeRolePlaceholder}
          onChange={(event) => { setRole(event.target.value); queue({ role: event.target.value }); }}
        />
      </label>
      <div style={{ fontSize: 10.5, color: TOKENS.textFaint, lineHeight: 1.45, marginBottom: 12 }}>{t.nodeRoleHint}</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint }}>{t.nodeOutput}</span>
        <textarea
          className="cf-field"
          rows={4}
          value={output}
          placeholder={t.nodeOutputPlaceholder}
          style={{ resize: 'vertical', lineHeight: 1.5 }}
          onChange={(event) => { setOutput(event.target.value); queue({ output: event.target.value }); }}
        />
      </label>
      <div style={{ fontSize: 10.5, color: TOKENS.textFaint, lineHeight: 1.45, marginBottom: 12 }}>{t.nodeOutputHint}</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0 10px', borderTop: '1px solid ' + TOKENS.border }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: TOKENS.text }}>{t.nodeSchedule}</div>
          <div style={{ fontSize: 10.5, color: TOKENS.textFaint, lineHeight: 1.4 }}>{t.nodeScheduleHint}</div>
        </div>
        <button
          type="button"
          className={'cf-btn' + (isOn ? ' is-on' : '')}
          aria-pressed={isOn}
          onClick={() => onPatch({ schedule: { ...schedule, enabled: !isOn } })}
        >
          {isOn ? t.nodeScheduleOn : t.nodeScheduleOff}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint }}>{t.everyMinutes}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <input
            className="cf-num"
            type="number"
            min="1"
            max="720"
            value={minutes}
            aria-label={t.nodeSchedule}
            onChange={(event) => {
              const next = Math.min(720, Math.max(1, Number(event.target.value) || 1));
              setMinutes(next);
              onPatch({ schedule: { ...schedule, enabled: isOn, everyMinutes: next } });
            }}
          />
          <span style={{ fontSize: 11, color: TOKENS.textMuted }}>{t.minutesUnit}</span>
        </span>
      </div>

      <div style={{ fontSize: 10.5, color: TOKENS.textFaint, marginBottom: 12 }}>
        {t.lastRun}：{node.lastRunAt ? new Date(node.lastRunAt).toLocaleString() : t.neverRun}
      </div>
      {node.pendingAt && Date.now() - node.pendingAt < 10 * 60_000 ? (
        <div style={{ fontSize: 10.5, color: TOKENS.accent, marginBottom: 12 }}>⏳ {t.nodeExecuting}</div>
      ) : null}

      <button type="button" className="cf-btn primary" style={{ width: '100%', padding: '8px 10px', fontSize: 12 }} disabled={busy} onClick={onRun}>
        {busy ? t.runningNow : t.runNow}
      </button>
      <button type="button" className="cf-btn danger" style={{ width: '100%', padding: '7px 10px', fontSize: 11.5, marginTop: 8 }} onClick={onRemove}>
        {t.nodeRemove}
      </button>
    </aside>
  );
}

function TransferLog({ t, transfers }) {
  return (
    <div style={{ borderTop: '1px solid ' + TOKENS.border, background: TOKENS.surface, maxHeight: 132, overflow: 'auto', padding: '8px 14px 10px' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint, marginBottom: 6 }}>
        {t.transfers} · {transfers.length}
      </div>
      {transfers.length === 0 ? (
        <div style={{ fontSize: 11, color: TOKENS.textFaint }}>{t.noTransfers}</div>
      ) : (
        transfers.slice(0, 20).map((item, index) => (
          <div key={item.id || index} style={{ display: 'flex', gap: 8, fontSize: 11, color: TOKENS.textMuted, padding: '3px 0', lineHeight: 1.5 }}>
            <span style={{ color: item.ok ? TOKENS.success : TOKENS.danger, flex: 'none' }}>{item.ok ? '✓' : '✕'}</span>
            <span style={{ color: TOKENS.textFaint, flex: 'none' }}>{item.at}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.fromTitle} → {item.toTitle} · {item.kindLabel} · {t.chars}: {item.chars}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------- canvas look */

const DEFAULT_CANVAS = { bgColor: null, grid: true, variant: 'dots', gap: 22, gridColor: null };

const BG_PRESETS = [
  { key: 'theme', value: null },
  { key: 'ink', value: '#0b0d12' },
  { key: 'graphite', value: '#14161b' },
  { key: 'slate', value: '#1b2230' },
  { key: 'forest', value: '#12211a' },
  { key: 'sand', value: '#f4efe4' },
  { key: 'snow', value: '#ffffff' },
];

const GAP_OPTIONS = [12, 16, 22, 28, 36, 48];

const VARIANT_OF = {
  dots: BackgroundVariant.Dots,
  lines: BackgroundVariant.Lines,
  cross: BackgroundVariant.Cross,
};

/** Same rule the Host uses, so a reload keeps the look identical. */
function normalizeCanvas(raw) {
  const base = DEFAULT_CANVAS;
  if (!raw || typeof raw !== 'object') return base;
  return {
    bgColor: /^#[0-9a-fA-F]{6}$/.test(raw.bgColor || '') ? raw.bgColor.toLowerCase() : null,
    grid: raw.grid !== false,
    variant: VARIANT_OF[raw.variant] ? raw.variant : base.variant,
    gap: Number.isFinite(raw.gap) ? Math.min(120, Math.max(8, Math.round(raw.gap))) : base.gap,
    gridColor: /^#[0-9a-fA-F]{6}$/.test(raw.gridColor || '') ? raw.gridColor.toLowerCase() : null,
  };
}

/** Relative luminance test, used to pick a readable default grid color. */
function isLightColor(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return false;
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

function gridColorFor(canvas) {
  if (canvas.gridColor) return canvas.gridColor;
  const light = canvas.bgColor ? isLightColor(canvas.bgColor) : false;
  return light ? 'rgba(15,18,22,0.24)' : 'rgba(232,235,240,0.18)';
}

function CanvasIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="1.6" y="1.6" width="12.8" height="12.8" rx="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.6 9.4h12.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.1" cy="5.6" r="1.15" fill="currentColor" />
    </svg>
  );
}

/** Background color, grid pattern, spacing and grid color for the canvas. */
function CanvasToolbar({ t, canvas, onChange }) {
  const [open, setOpen] = useState(false);
  const light = canvas.bgColor ? isLightColor(canvas.bgColor) : false;
  const patch = (next) => onChange(next);

  return (
    <div className="cf-canvas-tools">
      <button
        type="button"
        className="cf-btn"
        onClick={() => setOpen((value) => !value)}
        title={t.canvas}
        aria-expanded={open}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
      >
        <CanvasIcon />
        {t.canvas}
      </button>
      {open ? (
        <div className="cf-canvas-panel">
          <div className="cf-canvas-row">
            <span className="cf-canvas-label">{t.canvasBg}</span>
            <input
              className="cf-color"
              type="color"
              aria-label={t.canvasBg}
              value={canvas.bgColor || (light ? '#ffffff' : '#14161b')}
              onChange={(event) => patch({ bgColor: event.target.value.toLowerCase() })}
            />
          </div>
          <div className="cf-swatches">
            {BG_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className={
                  'cf-swatch' +
                  (preset.value === null ? ' theme' : '') +
                  (canvas.bgColor === preset.value ? ' is-active' : '')
                }
                style={preset.value ? { background: preset.value } : undefined}
                title={preset.value === null ? t.followTheme : preset.value}
                aria-label={preset.value === null ? t.followTheme : preset.value}
                onClick={() => patch({ bgColor: preset.value })}
              >
                {preset.value === null ? '⌂' : ''}
              </button>
            ))}
          </div>

          <div className="cf-canvas-row">
            <span className="cf-canvas-label">{t.grid}</span>
            <button
              type="button"
              className={'cf-btn' + (canvas.grid ? ' is-on' : '')}
              aria-pressed={canvas.grid}
              onClick={() => patch({ grid: !canvas.grid })}
            >
              {t.gridShow}
            </button>
          </div>
          <div className="cf-canvas-row">
            <span className="cf-canvas-label">{t.gridStyle}</span>
            <select
              value={canvas.variant}
              disabled={!canvas.grid}
              aria-label={t.gridStyle}
              onChange={(event) => patch({ variant: event.target.value })}
            >
              <option value="dots">{t.gridDots}</option>
              <option value="lines">{t.gridLines}</option>
              <option value="cross">{t.gridCross}</option>
            </select>
          </div>
          <div className="cf-canvas-row">
            <span className="cf-canvas-label">{t.gridGap}</span>
            <select
              value={canvas.gap}
              disabled={!canvas.grid}
              aria-label={t.gridGap}
              onChange={(event) => patch({ gap: Number(event.target.value) })}
            >
              {GAP_OPTIONS.includes(canvas.gap) ? null : (
                <option value={canvas.gap}>{canvas.gap}px</option>
              )}
              {GAP_OPTIONS.map((gap) => (
                <option key={gap} value={gap}>
                  {gap}px
                </option>
              ))}
            </select>
          </div>
          <div className="cf-canvas-row">
            <span className="cf-canvas-label">{t.gridColor}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <button type="button" className={'cf-btn' + (canvas.gridColor ? '' : ' is-on')} onClick={() => patch({ gridColor: null })}>
                {t.gridAuto}
              </button>
              <input
                className="cf-color"
                type="color"
                aria-label={t.gridColor}
                value={canvas.gridColor || (light ? '#0f1216' : '#e8ebf0')}
                onChange={(event) => patch({ gridColor: event.target.value.toLowerCase() })}
              />
            </span>
          </div>
          <div className="cf-canvas-row" style={{ marginTop: 11 }}>
            <span />
            <button type="button" className="cf-btn" onClick={() => patch(DEFAULT_CANVAS)}>
              {t.canvasReset}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- page */

function FlowPage({ ctx, t, tokens, sessions, graph, canvas, topics, activeTopicId, transfers, onGraphChange, onCanvasChange, onSelectTopic, onCreateTopic, onRenameTopic, onDeleteTopic, onTransfer, onToast, sessionLookup, openSession }) {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [nodeBusy, setNodeBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const saveTimer = useRef(null);
  const dirty = useRef(false);
  const look = normalizeCanvas(canvas);

  const kindLabel = useCallback(
    (kind) => (kind === 'recent' ? t.kindRecent : kind === 'custom' ? t.kindCustom : kind === 'transcript' ? t.kindTranscript : t.kindSummary),
    [t],
  );

  /* build React Flow nodes from persisted graph + live session metadata */
  useEffect(() => {
    const map = new Map(sessions.map((session) => [session.id, session]));
    setNodes((current) => {
      const known = new Map(current.map((node) => [node.id, node]));
      return (graph.nodes || []).map((stored) => {
        const session = map.get(stored.sessionId);
        const prev = known.get(stored.id);
        return {
          id: stored.id,
          type: 'conversation',
          position: { x: stored.x, y: stored.y },
          selected: prev ? prev.selected : false,
          data: {
            tokens,
            t,
            title: (session && session.title) || stored.sessionId,
            preview: session ? session.preview : '',
            live: !!(session && session.live),
            busy: !!(session && session.busy),
            turns: session ? session.turns : 0,
            updated: session ? session.updatedText : '',
            sessionId: stored.sessionId,
            role: stored.role || '',
            hasOutput: !!(stored.output && stored.output.trim()),
            scheduleOn: !!(stored.schedule && stored.schedule.enabled),
            scheduleMinutes: stored.schedule ? stored.schedule.everyMinutes : 10,
            pending: !!(stored.pendingAt && Date.now() - stored.pendingAt < 10 * 60_000),
            outCount: (graph.edges || []).filter((edge) => edge.source === stored.id).length,
            onOpen: () => openSession(stored.sessionId),
            onSend: () => sendAllOutgoing(stored.id),
            onRemove: () => removeNode(stored.id),
          },
        };
      });
    });
  }, [graph.nodes, graph.edges, sessions, t, tokens, openSession]);

  /* build edges (merge live config with the persisted definition) */
  useEffect(() => {
    setEdges((current) => {
      const prev = new Map(current.map((edge) => [edge.id, edge]));
      const look = new Map(sessions.map((session) => [session.id, session]));
      return (graph.edges || []).map((stored) => {
        const sourceSession = look.get((graph.nodes || []).find((n) => n.id === stored.source)?.sessionId);
        const targetSession = look.get((graph.nodes || []).find((n) => n.id === stored.target)?.sessionId);
        return {
          id: stored.id,
          source: stored.source,
          target: stored.target,
          type: 'default',
          className: stored.auto ? 'cf-auto' : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: TOKENS.textFaint },
          label: (stored.auto ? '⟳ ' : '') + kindLabel(stored.kind),
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          selected: prev.has(stored.id) ? prev.get(stored.id).selected : false,
          data: {
            kind: stored.kind,
            auto: stored.auto,
            text: stored.text || '',
            recentCount: stored.recentCount || 3,
            sourceTitle: (sourceSession && sourceSession.title) || stored.source,
            targetTitle: (targetSession && targetSession.title) || stored.target,
          },
        };
      });
    });
  }, [graph.edges, graph.nodes, sessions, kindLabel]);

  const persist = useCallback(
    (nextNodes, nextEdges) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      dirty.current = true;
      saveTimer.current = setTimeout(() => {
        const graphNext = {
          nodes: nextNodes.map((node) => {
            const stored = (graph.nodes || []).find((item) => item.id === node.id);
            return {
              id: node.id,
              sessionId: stored ? stored.sessionId : node.data.sessionId,
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
              role: stored ? stored.role || '' : '',
              output: stored ? stored.output || '' : '',
              schedule: stored && stored.schedule ? stored.schedule : { enabled: false, everyMinutes: 10 },
              lastRunAt: stored && stored.lastRunAt ? stored.lastRunAt : 0,
              pendingAt: stored && stored.pendingAt ? stored.pendingAt : 0,
            };
          }),
          edges: nextEdges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            kind: edge.data ? edge.data.kind : 'summary',
            auto: edge.data ? !!edge.data.auto : false,
            text: edge.data ? edge.data.text : '',
            recentCount: edge.data ? edge.data.recentCount : 3,
          })),
        };
        dirty.current = false;
        onGraphChange(graphNext).catch((error) => onToast(t.saveFailed + ': ' + error.message, true));
      }, 350);
    },
    [graph.nodes, onGraphChange, onToast, t],
  );

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const onNodesChange = useCallback(
    (changes) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        if (changes.some((change) => change.type === 'position' && change.dragging === false)) persist(next, edges);
        return next;
      });
    },
    [edges, persist],
  );

  const onEdgesChange = useCallback(
    (changes) => {
      setEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        if (changes.some((change) => change.type === 'remove')) persist(nodes, next);
        return next;
      });
    },
    [nodes, persist],
  );

  const addNode = useCallback(
    (session) => {
      const existing = (graph.nodes || []).find((node) => node.sessionId === session.id);
      if (existing) return;
      const index = (graph.nodes || []).length;
      const node = {
        id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        sessionId: session.id,
        x: 48 + (index % 3) * (NODE_WIDTH + 56),
        y: 40 + Math.floor(index / 3) * 168,
      };
      const graphNext = { nodes: [...(graph.nodes || []), node], edges: graph.edges || [] };
      onGraphChange(graphNext).catch((error) => onToast(t.saveFailed + ': ' + error.message, true));
    },
    [graph.nodes, graph.edges, onGraphChange, onToast, t],
  );

  const removeNode = useCallback(
    (nodeId) => {
      const graphNext = {
        nodes: (graph.nodes || []).filter((node) => node.id !== nodeId),
        edges: (graph.edges || []).filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      };
      onGraphChange(graphNext).catch((error) => onToast(t.saveFailed + ': ' + error.message, true));
    },
    [graph.nodes, graph.edges, onGraphChange, onToast, t],
  );

  const onConnect = useCallback(
    (connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const exists = (graph.edges || []).some((edge) => edge.source === connection.source && edge.target === connection.target);
      if (exists) {
        onToast(t.noSelection);
        return;
      }
      const edge = {
        id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        source: connection.source,
        target: connection.target,
        kind: 'summary',
        auto: false,
        text: '',
        recentCount: 3,
      };
      const graphNext = { nodes: graph.nodes || [], edges: [...(graph.edges || []), edge] };
      onGraphChange(graphNext).catch((error) => onToast(t.saveFailed + ': ' + error.message, true));
    },
    [graph.nodes, graph.edges, onGraphChange, onToast, t],
  );

  const selectedEdge = useMemo(() => (graph.edges || []).find((edge) => edge.id === selectedEdgeId), [graph.edges, selectedEdgeId]);
  const selectedNode = useMemo(() => (graph.nodes || []).find((node) => node.id === selectedNodeId) || null, [graph.nodes, selectedNodeId]);

  const patchNode = useCallback(
    async (patch) => {
      if (!selectedNodeId) return;
      const graphNext = {
        nodes: (graph.nodes || []).map((node) => (node.id === selectedNodeId ? { ...node, ...patch } : node)),
        edges: graph.edges || [],
      };
      try {
        await onGraphChange(graphNext);
      } catch (error) {
        onToast(t.saveFailed + ': ' + error.message, true);
      }
    },
    [selectedNodeId, graph.nodes, graph.edges, onGraphChange, onToast, t],
  );

  const runSelectedNode = useCallback(async () => {
    if (!selectedNode) return;
    setNodeBusy(true);
    try {
      const value = await api.runNode({ nodeId: selectedNode.id });
      if (value && value.error) onToast(value.error, true);
      else if (value && value.kicked && value.pending) onToast(t.nodeExecuting);
      else if (value && value.sent > 0) onToast(t.sentNow + ' × ' + value.sent);
      else if (value && value.failed > 0) onToast(t.transferFailed.replace('{reason}', String(value.failed)), true);
      setSelectedNodeId(selectedNode.id);
    } catch (error) {
      onToast(error.message, true);
    } finally {
      setNodeBusy(false);
    }
  }, [selectedNode, onToast, t]);
  const selectedEdgeFull = useMemo(() => {
    if (!selectedEdge) return null;
    const sourceNode = (graph.nodes || []).find((node) => node.id === selectedEdge.source);
    const targetNode = (graph.nodes || []).find((node) => node.id === selectedEdge.target);
    const sourceSession = sourceNode ? sessionLookup(sourceNode.sessionId) : null;
    const targetSession = targetNode ? sessionLookup(targetNode.sessionId) : null;
    return {
      ...selectedEdge,
      sourceTitle: (sourceSession && sourceSession.title) || (sourceNode && sourceNode.sessionId) || '?',
      targetTitle: (targetSession && targetSession.title) || (targetNode && targetNode.sessionId) || '?',
    };
  }, [selectedEdge, graph.nodes, sessionLookup]);

  const patchEdge = useCallback(
    (patch) => {
      if (!selectedEdge) return;
      const graphNext = {
        nodes: graph.nodes || [],
        edges: (graph.edges || []).map((edge) => (edge.id === selectedEdge.id ? { ...edge, ...patch } : edge)),
      };
      onGraphChange(graphNext).catch((error) => onToast(t.saveFailed + ': ' + error.message, true));
    },
    [selectedEdge, graph.nodes, graph.edges, onGraphChange, onToast, t],
  );

  const runTransfer = useCallback(
    async (edgeIds) => {
      if (!edgeIds.length) {
        onToast(t.noSelection);
        return;
      }
      setSending(true);
      setSendError(null);
      try {
        for (const edgeId of edgeIds) {
          const edge = (graph.edges || []).find((item) => item.id === edgeId);
          if (!edge) continue;
          try {
            const value = await api.transfer({
              edgeId: edge.id,
              source: edge.source,
              target: edge.target,
              kind: edge.kind,
              text: edge.text,
              recentCount: edge.recentCount,
            });
            onToast(t.transferred.replace('{to}', value.targetTitle || edge.target));
          } catch (error) {
            setSendError(t.transferFailed.replace('{reason}', error.message));
          }
        }
      } finally {
        setSending(false);
      }
    },
    [graph.edges, onToast, t],
  );

  const sendAllOutgoing = useCallback(
    (nodeId) => {
      const ids = (graph.edges || []).filter((edge) => edge.source === nodeId).map((edge) => edge.id);
      runTransfer(ids);
    },
    [graph.edges, runTransfer],
  );

  const canvasSessionIds = useMemo(() => new Set((graph.nodes || []).map((node) => node.sessionId)), [graph.nodes]);

  const [topicDraft, setTopicDraft] = useState(null); // null | 'create' | 'rename'
  const [topicName, setTopicName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activeTopic = (topics || []).find((topic) => topic.id === activeTopicId) || (topics || [])[0] || null;

  return (
    <div className="cf-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: TOKENS.surface }}>
      <style>{flowCss + flowStyles(TOKENS)}</style>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', paddingTop: 'calc(10px + ' + TOKENS.topClearance + ')', borderBottom: '1px solid ' + TOKENS.border, flex: 'none' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: TOKENS.text }}>{t.title}</div>
          <div style={{ fontSize: 11, color: TOKENS.textFaint, marginTop: 2 }}>{t.subtitle}</div>
        </div>
        <span style={{ fontSize: 11, color: TOKENS.textFaint }}>
          {(graph.nodes || []).length} {t.sessions} · {(graph.edges || []).length} {t.inspector}
        </span>
        <button type="button" className="cf-btn" onClick={() => runTransfer((graph.edges || []).map((edge) => edge.id))} disabled={sending || !(graph.edges || []).length}>
          {sending ? t.transferring : t.transferNow}
        </button>
      </header>
      <div className="cf-topicbar" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid ' + TOKENS.border, flex: 'none', background: TOKENS.surfaceMuted }}>
        <span style={{ fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', color: TOKENS.textFaint }}>{t.topics}</span>
        <select
          className="cf-topic-select"
          value={activeTopicId || ''}
          aria-label={t.topics}
          onChange={(event) => onSelectTopic(event.target.value)}
        >
          {(topics || []).map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}（{topic.nodeCount || 0}）
            </option>
          ))}
        </select>

        {topicDraft ? (
          <>
            <input
              className="cf-field"
              style={{ width: 190, padding: '4px 7px' }}
              autoFocus
              value={topicName}
              placeholder={t.topicNamePlaceholder}
              onChange={(event) => setTopicName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  const name = topicName.trim();
                  if (name) {
                    if (topicDraft === 'create') onCreateTopic(name);
                    else onRenameTopic(name);
                  }
                  setTopicDraft(null);
                  setTopicName('');
                } else if (event.key === 'Escape') {
                  setTopicDraft(null);
                }
              }}
            />
            <button
              type="button"
              className="cf-btn primary"
              disabled={!topicName.trim()}
              onClick={() => {
                const name = topicName.trim();
                if (!name) return;
                if (topicDraft === 'create') onCreateTopic(name);
                else onRenameTopic(name);
                setTopicDraft(null);
                setTopicName('');
              }}
            >
              {t.confirm}
            </button>
            <button type="button" className="cf-btn" onClick={() => { setTopicDraft(null); setTopicName(''); }}>
              {t.cancel}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="cf-btn" onClick={() => { setTopicDraft('create'); setTopicName(''); }}>
              ＋ {t.newTopic}
            </button>
            <button
              type="button"
              className="cf-btn"
              onClick={() => { setTopicDraft('rename'); setTopicName(activeTopic ? activeTopic.name : ''); }}
            >
              {t.renameTopic}
            </button>
            <button
              type="button"
              className={'cf-btn' + (confirmDelete ? ' danger' : '')}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  return;
                }
                setConfirmDelete(false);
                if (activeTopic) onDeleteTopic();
              }}
            >
              {confirmDelete ? t.topicDeleteConfirm.replace('{name}', activeTopic ? activeTopic.name : '') : t.deleteTopic}
            </button>
          </>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: TOKENS.textFaint }}>
          {(topics || []).length} {t.topics}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '236px minmax(0, 1fr) 288px', flex: 1, minHeight: 0 }}>
        <Rail t={t} sessions={sessions} onAdd={addNode} onOpen={(session) => openSession(session.id)} canvasSessionIds={canvasSessionIds} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, position: 'relative' }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', background: look.bgColor || undefined }}>
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
                onNodeClick={(_event, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
                onPaneClick={() => { setSelectedEdgeId(null); setSelectedNodeId(null); }}
                fitView
                minZoom={0.2}
                maxZoom={1.8}
                proOptions={{ hideAttribution: true }}
                style={{ position: 'absolute', inset: 0, background: look.bgColor || undefined }}
              >
                {look.grid ? (
                  <Background
                    variant={VARIANT_OF[look.variant] || BackgroundVariant.Dots}
                    gap={look.gap}
                    size={look.variant === 'cross' ? 6 : look.variant === 'lines' ? 1 : 1.2}
                    color={gridColorFor(look)}
                  />
                ) : null}
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable style={{ width: 132, height: 88 }} />
              </ReactFlow>
            </ReactFlowProvider>
            <CanvasToolbar t={t} canvas={look} onChange={onCanvasChange} />
            {!(graph.nodes || []).length ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontSize: 12, color: TOKENS.textFaint }}>
                {t.empty}
              </div>
            ) : null}
          </div>
          <TransferLog t={t} transfers={transfers} />
        </div>
        {selectedNode ? (
          <NodeInspector
            t={t}
            node={selectedNode}
            sessionTitle={
              ((sessionLookup(selectedNode.sessionId) || {}).title) || selectedNode.sessionId
            }
            busy={nodeBusy}
            onPatch={patchNode}
            onRun={runSelectedNode}
            onRemove={() => {
              const nodeId = selectedNode.id;
              setSelectedNodeId(null);
              removeNode(nodeId);
            }}
          />
        ) : (
          <Inspector
            t={t}
            edge={selectedEdgeFull}
            edgeSource={selectedEdgeFull ? selectedEdgeFull.sourceTitle : ''}
            edgeTarget={selectedEdgeFull ? selectedEdgeFull.targetTitle : ''}
            onChange={patchEdge}
            busy={sending}
            transferError={sendError}
            onTransfer={() => runTransfer(selectedEdge ? [selectedEdge.id] : [])}
            onDelete={() => {
              if (!selectedEdge) return;
              const graphNext = {
                nodes: graph.nodes || [],
                edges: (graph.edges || []).filter((edge) => edge.id !== selectedEdge.id),
              };
              setSelectedEdgeId(null);
              onGraphChange(graphNext).catch((error) => onToast(t.saveFailed + ': ' + error.message, true));
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export function ConversationFlowPage({ ctx }) {
  const t = useMessages(ctx);
  const [sessions, setSessions] = useState([]);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [topics, setTopics] = useState([]);
  const [activeTopicId, setActiveTopicId] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [canvas, setCanvasState] = useState(DEFAULT_CANVAS);
  const canvasRef = useRef(DEFAULT_CANVAS);
  const graphRef = useRef({ nodes: [], edges: [] });
  const activeTopicRef = useRef(null);

  const onToast = useCallback((text, isError) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current.slice(-2), { id, text, isError }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  const applyCanvas = useCallback((next) => {
    canvasRef.current = next;
    setCanvasState(next);
  }, []);

  /** Merge a server snapshot: nodes/edges only when they actually changed, and
   *  the canvas look only when it differs from the local one (so a poll cannot
   *  fight a colour pick in progress). */
  const applySnapshot = useCallback(
    (value) => {
      setSessions(value.sessions || []);
      setTopics(value.topics || []);
      setActiveTopicId(value.activeTopicId || null);
      activeTopicRef.current = value.activeTopicId || null;
      const remote = {
        nodes: (value.graph && value.graph.nodes) || [],
        edges: (value.graph && value.graph.edges) || [],
      };
      graphRef.current = remote;
      setGraph((current) => {
        const same =
          JSON.stringify(current.nodes) === JSON.stringify(remote.nodes) &&
          JSON.stringify(current.edges) === JSON.stringify(remote.edges);
        return same ? current : remote;
      });
      const remoteCanvas = normalizeCanvas(value.graph && value.graph.canvas);
      if (JSON.stringify(remoteCanvas) !== JSON.stringify(canvasRef.current)) applyCanvas(remoteCanvas);
      setTransfers(value.transfers || []);
    },
    [applyCanvas],
  );

  const refresh = useCallback(async () => {
    try {
      applySnapshot(await api.state());
    } catch (error) {
      onToast(t.offline, true);
    }
  }, [applySnapshot, onToast, t]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      api.state().then(applySnapshot).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [applySnapshot, refresh]);

  const openSession = useCallback(
    (sessionId) => {
      const workspace = ctx && ctx.get ? ctx.get('uiWorkspace') : undefined;
      if (workspace && typeof workspace.openSession === 'function') workspace.openSession({ sessionId });
      const layout = ctx && ctx.get ? ctx.get('layout') : undefined;
      if (layout && typeof layout.selectPanel === 'function') {
        try {
          layout.selectPanel(null);
        } catch (error) {
          /* a panel without a Conversation seat keeps the current selection */
        }
      }
    },
    [ctx],
  );

  const sessionLookup = useCallback(
    (sessionId) => sessions.find((session) => session.id === sessionId) || null,
    [sessions],
  );

  const onGraphChange = useCallback(async (next) => {
    const payload = {
      nodes: next.nodes || [],
      edges: next.edges || [],
      canvas: canvasRef.current,
    };
    graphRef.current = { nodes: payload.nodes, edges: payload.edges };
    setGraph({ nodes: payload.nodes, edges: payload.edges });
    await api.saveGraph(payload);
  }, []);

  /** Persist the canvas look together with the current nodes/edges. */
  const onCanvasChange = useCallback(
    async (patch) => {
      const next = normalizeCanvas({ ...canvasRef.current, ...patch });
      applyCanvas(next);
      try {
        await api.saveGraph({ nodes: graphRef.current.nodes, edges: graphRef.current.edges, canvas: next });
      } catch (error) {
        onToast(t.saveFailed + ': ' + error.message, true);
      }
    },
    [applyCanvas, onToast, t],
  );

  /** 主题操作：改完后立即拉一次快照，画布、选项与统计一起刷新。 */
  const runTopicAction = useCallback(
    async (payload) => {
      try {
        const value = await api.topic(payload);
        setTopics(value.topics || []);
        setActiveTopicId(value.activeTopicId || null);
        activeTopicRef.current = value.activeTopicId || null;
        await refresh();
      } catch (error) {
        onToast(error.message, true);
      }
    },
    [refresh, onToast],
  );

  const selectTopic = useCallback(
    (topicId) => {
      if (!topicId || topicId === activeTopicRef.current) return;
      runTopicAction({ action: 'select', topicId });
    },
    [runTopicAction],
  );

  const createTopic = useCallback(
    async (name) => {
      await runTopicAction({ action: 'create', name });
      onToast(t.topicCreated.replace('{name}', name));
    },
    [runTopicAction, onToast, t],
  );

  const renameTopic = useCallback(
    async (name) => {
      await runTopicAction({ action: 'rename', topicId: activeTopicRef.current, name });
      onToast(t.topicRenamed);
    },
    [runTopicAction, onToast, t],
  );

  const deleteTopic = useCallback(async () => {
    await runTopicAction({ action: 'delete', topicId: activeTopicRef.current });
    onToast(t.topicDeleted);
  }, [runTopicAction, onToast, t]);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 0 }}>
      <FlowPage
        ctx={ctx}
        t={t}
        tokens={TOKENS}
        sessions={sessions}
        graph={graph}
        canvas={canvas}
        topics={topics}
        activeTopicId={activeTopicId}
        transfers={transfers}
        onGraphChange={onGraphChange}
        onCanvasChange={onCanvasChange}
        onSelectTopic={selectTopic}
        onCreateTopic={createTopic}
        onRenameTopic={renameTopic}
        onDeleteTopic={deleteTopic}
        onToast={onToast}
        sessionLookup={sessionLookup}
        openSession={openSession}
      />
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 30, pointerEvents: 'none' }}>
        {toasts.map((item) => (
          <div
            key={item.id}
            style={{
              padding: '7px 12px', borderRadius: TOKENS.radiusSm, fontSize: 11.5, color: TOKENS.text,
              background: TOKENS.surfaceMuted, border: '1px solid ' + (item.isError ? TOKENS.danger : TOKENS.border),
              boxShadow: '0 8px 20px rgba(0,0,0,.3)',
            }}
          >
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}
