/**
 * Conversation Flow — React Flow canvas for DSH.
 * Shared client-side helpers: i18n, host API client, theme tokens.
 */

export const MESSAGES = {
  zh: {
    title: '对话流',
    subtitle: '在多个对话之间搬运数据，并编排它们之间的协作',
    refresh: '刷新',
    addNode: '添加对话',
    empty: '从左侧选择一个对话，把它放到画布上',
    emptyList: '还没有可用的对话',
    sessions: '对话',
    onCanvas: '已在画布',
    live: '运行中',
    idle: '空闲',
    busy: '思考中',
    noAgent: '未激活',
    search: '搜索对话…',
    send: '发送数据',
    open: '打开',
    remove: '从画布移除',
    inspector: '连线设置',
    noSelection: '选中一条连线以配置传输方式',
    payloadKind: '传输内容',
    kindSummary: '最后一轮摘要',
    kindRecent: '最近几轮对话',
    kindCustom: '自定义文本',
    kindTranscript: '完整对话记录',
    auto: '自动协调',
    autoHint: '当源对话一轮结束时，自动把内容推送到目标对话',
    manualHint: '只在你点击「立即传输」时推送',
    transferNow: '立即传输',
    transferring: '传输中…',
    transferred: '已传输到「{to}」',
    transferFailed: '传输失败：{reason}',
    deleteEdge: '删除连线',
    customPlaceholder: '输入要推送到目标对话的文本…',
    transfers: '传输记录',
    noTransfers: '还没有传输记录',
    saved: '已保存',
    saveFailed: '保存失败',
    offline: '无法连接 Host，稍后自动重试',
    round: '轮',
    chars: '字',
    from: '来自',
    openGraph: '对话流',
    toasts: '提示',
    autoOn: '自动协调',
    autoOff: '手动',
    recentCount: '轮数',
    preview: '预览',
    payload: '内容',
    target: '目标',
    source: '源',
    created: '创建于',
    updated: '更新于',
    canvasHint: '拖动节点右侧圆点到另一个节点即可建立数据通道',
    canvas: '画布',
    canvasBg: '背景色',
    followTheme: '跟随主题',
    grid: '网格线',
    gridShow: '显示网格',
    gridStyle: '网格样式',
    gridDots: '点阵',
    gridLines: '横线',
    gridCross: '交叉',
    gridGap: '网格间距',
    gridColor: '网格颜色',
    gridAuto: '自动',
    canvasReset: '恢复默认',
    nodeSettings: '节点设置',
    nodeRole: '节点作用',
    nodeRolePlaceholder: '例如：负责架构决策，把结论交给实现节点',
    nodeRoleHint: '执行节点时，这段作用会作为任务指令发给它的对话，驱动对话按职责完成工作',
    nodeOutput: '输出内容',
    nodeOutputPlaceholder: '留空：按连线类型从对话里取内容；填写后：该节点总是输出这段文本',
    nodeOutputHint: '填写后优先使用这段文本作为下游内容，执行时直接推送，不必等对话产出',
    nodeSchedule: '定时',
    nodeScheduleOn: '已开启',
    nodeScheduleOff: '已关闭',
    nodeScheduleHint: '开启后按间隔执行节点：先按职责驱动对话，再把结果推给下游通道',
    nodeExecuting: '执行中：等待该对话产出',
    everyMinutes: '每',
    minutesUnit: '分钟',
    lastRun: '上次运行',
    neverRun: '尚未运行',
    runNow: '立即执行',
    runningNow: '执行中…',
    sentNow: '已推送',
    nodeRemove: '从画布移除',
    noNode: '点击画布上的节点以编辑它的作用、输出与定时',
  },
  en: {
    title: 'Conversation Flow',
    subtitle: 'Move data between conversations and coordinate them',
    refresh: 'Refresh',
    addNode: 'Add conversation',
    empty: 'Pick a conversation on the left to place it on the canvas',
    emptyList: 'No conversations available',
    sessions: 'Conversations',
    onCanvas: 'On canvas',
    live: 'Running',
    idle: 'Idle',
    busy: 'Thinking',
    noAgent: 'Not active',
    search: 'Search conversations…',
    send: 'Send data',
    open: 'Open',
    remove: 'Remove from canvas',
    inspector: 'Link settings',
    noSelection: 'Select a link to configure how data moves',
    payloadKind: 'Payload',
    kindSummary: 'Last turn summary',
    kindRecent: 'Recent turns',
    kindCustom: 'Custom text',
    kindTranscript: 'Full transcript',
    auto: 'Auto coordinate',
    autoHint: 'When the source finishes a turn, push its content to the target',
    manualHint: 'Push only when you press Send now',
    transferNow: 'Send now',
    transferring: 'Sending…',
    transferred: 'Sent to "{to}"',
    transferFailed: 'Send failed: {reason}',
    deleteEdge: 'Delete link',
    customPlaceholder: 'Text to push into the target conversation…',
    transfers: 'Transfer log',
    noTransfers: 'No transfers yet',
    saved: 'Saved',
    saveFailed: 'Save failed',
    offline: 'Cannot reach Host, retrying',
    round: 'turns',
    chars: 'chars',
    from: 'from',
    openGraph: 'Conversation Flow',
    toasts: 'Notices',
    autoOn: 'Auto',
    autoOff: 'Manual',
    recentCount: 'Turns',
    preview: 'Preview',
    payload: 'Payload',
    target: 'Target',
    source: 'Source',
    created: 'Created',
    updated: 'Updated',
    canvasHint: 'Drag from the dot on a node to another node to create a data channel',
    canvas: 'Canvas',
    canvasBg: 'Background',
    followTheme: 'Theme default',
    grid: 'Grid',
    gridShow: 'Show grid',
    gridStyle: 'Pattern',
    gridDots: 'Dots',
    gridLines: 'Lines',
    gridCross: 'Cross',
    gridGap: 'Spacing',
    gridColor: 'Grid color',
    gridAuto: 'Auto',
    canvasReset: 'Reset canvas',
    nodeSettings: 'Node settings',
    nodeRole: 'Role',
    nodeRolePlaceholder: 'e.g. Owns the architecture decision and hands the conclusion to the builder',
    nodeRoleHint: 'When the node runs, this role is sent to its conversation as the task instruction',
    nodeOutput: 'Output',
    nodeOutputPlaceholder: 'Empty: read the conversation per channel type. Filled: this node always emits this text',
    nodeOutputHint: 'When filled, this text is the downstream payload and is pushed without waiting for a turn',
    nodeSchedule: 'Timer',
    nodeScheduleOn: 'On',
    nodeScheduleOff: 'Off',
    nodeScheduleHint: 'When on, the node runs on every interval: it drives its conversation, then pushes the result downstream',
    nodeExecuting: 'Running: waiting for the conversation to answer',
    everyMinutes: 'every',
    minutesUnit: 'min',
    lastRun: 'Last run',
    neverRun: 'never',
    runNow: 'Run now',
    runningNow: 'Running…',
    sentNow: 'Pushed',
    nodeRemove: 'Remove from canvas',
    noNode: 'Click a node to edit its role, output and timer',
  },
};

export function translate(localeId, key, params) {
  const table = MESSAGES[localeId] || MESSAGES.zh;
  let text = table[key] != null ? table[key] : MESSAGES.zh[key] != null ? MESSAGES.zh[key] : key;
  if (params) {
    for (const k of Object.keys(params)) text = text.split('{' + k + '}').join(String(params[k]));
  }
  return text;
}

export function readLocaleId(snapshot) {
  if (!snapshot) return 'zh';
  const raw =
    typeof snapshot === 'string'
      ? snapshot
      : snapshot.active || snapshot.id || snapshot.locale || snapshot.lang || snapshot.language || '';
  const value = String(raw || '').toLowerCase();
  if (value.startsWith('zh')) return 'zh';
  if (value.startsWith('en')) return 'en';
  return value ? 'en' : 'zh';
}

/** Same-origin JSON client for the Host half of this plugin. */
const API_BASE = '/conversation-flow/api';

async function request(path, init) {
  const response = await fetch(API_BASE + path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    ...init,
  });
  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }
  if (!response.ok || !body || body.ok !== true) {
    const reason = (body && (body.error || body.reason)) || 'HTTP ' + response.status;
    throw new Error(reason);
  }
  return body.value;
}

export const api = {
  state: (signal) => request('/state', { method: 'GET', signal }),
  saveGraph: (graph) => request('/graph', { method: 'POST', body: JSON.stringify(graph) }),
  transfer: (payload) => request('/transfer', { method: 'POST', body: JSON.stringify(payload) }),
  setCoordinate: (payload) => request('/coordinate', { method: 'POST', body: JSON.stringify(payload) }),
  updateNode: (payload) => request('/node', { method: 'POST', body: JSON.stringify(payload) }),
  runNode: (payload) => request('/run', { method: 'POST', body: JSON.stringify(payload) }),
};

/** Design tokens copied from the Harness theme, with safe literal fallbacks. */
export const TOKENS = {
  bg: 'var(--dsw-alias-bg-base, #101215)',
  surface: 'var(--dsw-alias-bg-layer-1, #171a1f)',
  surfaceMuted: 'var(--dsw-alias-bg-layer-2, #1d2127)',
  surfaceHover: 'var(--dsw-alias-interactive-bg-hover, #242a32)',
  border: 'var(--dsw-alias-border-l1, #2b3138)',
  borderStrong: 'var(--dsw-alias-border-l3, #3a424c)',
  text: 'var(--dsw-alias-label-primary, #e8ebf0)',
  textMuted: 'var(--dsw-alias-label-secondary, #9aa3af)',
  textFaint: 'var(--dsw-alias-label-tertiary, #6d7683)',
  accent: 'var(--dsw-alias-brand-primary, #4d8dff)',
  accentSoft: 'var(--dsw-alias-bg-layer-3, rgba(77, 141, 255, 0.16))',
  success: 'var(--dsw-alias-state-success-primary, #3fbf7f)',
  warning: 'var(--dsw-alias-state-warn-primary, #e0a13d)',
  danger: 'var(--dsw-alias-state-error-primary, #e35d6a)',
  radius: 'var(--dsw-radius-md, 10px)',
  radiusSm: 'var(--dsw-radius-sm, 6px)',
  font: 'var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif)',
  mono: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
  topClearance: 'var(--dsh-frame-top-clearance, 0px)',
};
