# DSH Host API scout report — multi-session data transfer & coordination

Read-only investigation for a Host plugin that reads other conversations and pushes data into them.
Environment: DSH 0.2.1-rc.5 desktop profile (`DSH_PROFILE=desktop`, `DSH_PROFILE_DIR=C:\Users\Administrator\.dsh\profiles\desktop`),
built source extracted to `C:\Users\Administrator\AppData\Local\Temp\dsh-asar\extracted\dsh\node_modules\@deepseek-ai\`.

**Verification legend**
- `[VERIFIED]` — read from installed built JS source (`lib/**`) or from live `cordis_inspect_query` output.
- `[README]` — stated by the package's shipped README (authoritative doc, not code).
- `[UNVERIFIED]` — inference only; test before relying on it.

Method: `cordis_inspect_query` (host `Service`/`Event`/`Config`/`Tool` providers) against the **live** Host, plus grep/read of the built package sources.
Exact TypeScript declarations were recovered from the packages' **typert metadata** (`<pkg>/lib/typert.host.js`), which embeds the original
`.d.ts` text verbatim. A full 603-type dump was extracted to `.tmp-probe/b/decls.json` (dump it with `show.mjs <TypeName...>`).

---

## 0. TL;DR — the exact names to use

| Need | Use | Kind |
|---|---|---|
| List conversations + titles | `ctx.workspaceRegistry.list()` → `Workspace[]` (`id`, `path`, `title`, `sessionIds`, `createdAt`, `updatedAt`) | service |
| …persisted/live corpus | `ctx.sessionQuery.listSessions(signal?)` → `SessionRecord[]` = `{header: SessionHeader, live, persisted, formatStatus?}` | service |
| …titles for N ids | `ctx.sessionQuery.readTitleSnapshots(ids, signal?)` → `{sessionId, status, value:{session, title?: {title, eventSeq, updatedAt, messageSeqs, source}}}` | service |
| …archived / pinned sets | `ctx.workspaceRegistry.archivedSessionIds` / `.pinnedSessionIds` (getters on the registry) | service |
| …running/live agents | `ctx.agents.get(sessionId)` / `ctx.agents.list()` / `ctx.agents.roots()`; `agent.status === 'idle' \| 'running'` | service |
| …UI-shaped summaries (`running`, `agentAvailable`, `updatedAt`, `blank`) | `ctx.sessionController.list(_request, signal)` (Host-callable `@Remote('list')`) → `SessionListValue {items: SessionSummary[]}` | service |
| …titles without log I/O | `ctx.sessionProjectionCache.cachedSnapshot(header, ['title'])` → `{asOfSeq, values}` | service |
| Read last N turns | `ctx.sessionQuery.readSurface(sessionId)` → `{session, capturedThroughSeq, events: SurfaceEvent[]}` | service |
| Full log incl. tool calls | `ctx.sessionQuery.readSession(sessionId)` → `{session: SessionHeader, inheritedEventCount, events: SessionEvent[]}` | service |
| Deliver text into another conversation | `createUserMessage({content, source})` + `agent.followup(msg)` (wakes) / `agent.inject(msg)` (does not wake) | `@deepseek-ai/dsh-llm` + `Agent` |
| Turn-finished hook (durable) | `ctx.on('session/event', (session, event) => event.type === 'turn/end')` | event |
| Turn-finished hook (per-agent, reentrant) | `agent.ctx.on('agent/turn-stopping', ({agent, turn, signal}) => …)` | event |
| Register a tool | `ctx.tools.register(defineTool({name, description, parameters, output, execute}))` | service |
| Persist plugin JSON | `defineDomain(...)` + `ctx.storageDomain.open(spec)` → `domain.table(t).put/get/update` | service |
| HTTP route | `ctx.webServer.register({kind: 'exact'\|'prefix', path, handler})` → disposer | service |

---

## 1. Enumerating conversations, titles, metadata, liveness

### 1.1 Workspace registry (the product-level "conversation list")

`ctx.workspaceRegistry` `[VERIFIED: inspect Service catalog]`:

```
create(path: string, title?: string): Promise<Workspace>
initializeDefault(resolveDirectory: () => Promise<string>): Promise<Workspace | undefined>
get(id: WorkspaceId): Workspace | undefined
list(): Workspace[]
delete(id: WorkspaceId): Promise<boolean>
insertBefore(id, beforeId?): Promise<readonly WorkspaceId[]>
archiveSession(sessionId, options?): Promise<void>
unarchiveSession(sessionId: SessionId): Promise<void>
pinSession(sessionId: SessionId): Promise<void>
unpinSession(sessionId: SessionId): Promise<void>
resolveByPath(path: string): Promise<Workspace | undefined>
```

The `Workspace` entity is package-private but its surface is exact `[VERIFIED: dsh-workspace/lib/index.js:76-160]`:

```ts
interface Workspace {
  readonly id: WorkspaceId
  get path(): string
  get title(): string
  get createdAt(): number          // epoch ms
  get updatedAt(): number          // epoch ms
  get sessionIds(): SessionId[]    // filtered: only sessions whose stored cwd still resolves to this workspace
  setTitle(title: string): Promise<void>
  attachSession(sessionId): Promise<void>       // validates the session header's cwd == workspace path (realpath)
  insertSessionBefore(sessionId, beforeSessionId?): Promise<void>
  detachSession(sessionId): Promise<void>
  status(): Promise<'ok' | 'missing-dir'>
}
```

Durable storage layout `[VERIFIED: read `C:\Users\Administrator\.dsh\storages\workspace.json`, domain `workspace` v2]`:

```json
{"unit":{"name":"workspace","version":2},
 "global":{"initialized":true,"defaultWorkspaceId":"…","workspaceIds":["…"],
           "archivedSessionIds":["session-…"],"pinnedSessionIds":[]},
 "tables":{"workspaces":{"<workspaceId>":{"path":"F:\\…","title":"…",
           "sessionIds":["session-…"],"createdAt":"2026-11-03T08:13:03.598Z","updatedAt":"2026-11-03T11:42:34.178Z"}}}}
```
Note: `WorkspaceView` (the wire type used by `ctx.remote.workspace`) is the string-dated variant:
`{workspaceId, path, title, sessionIds, createdAt: string, updatedAt: string}` `[VERIFIED: dsh-api-workspace-controller/lib/typert.host.js]`.

### 1.2 Session corpus (independent of workspaces)

Exact declarations `[VERIFIED: typert metadata, dsh-session / dsh-session-query]`:

```ts
interface SessionHeader {
  readonly version: typeof SESSION_FORMAT_VERSION
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
}
interface SessionRecord {
  header: SessionHeader
  live: boolean
  persisted: boolean
  formatStatus?: 'current' | 'migration-required'
}
interface SessionTitleEventData { readonly title: string; readonly messageSeqs: SessionSeq[]; readonly source: SessionTitleSource }
interface SessionTitleSnapshot extends SessionTitleEventData { readonly eventSeq: SessionSeq; readonly updatedAt: number }
interface SessionTitleObservation { session: SessionHeader; title?: SessionTitleSnapshot }
interface SessionSummary {           // api-session-controller wire/summary type
  readonly agentAvailable: boolean
  readonly formatStatus?: 'current' | 'migration-required'
  readonly sessionId: SessionId
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly parentSessionId?: SessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly projections?: SessionProjectionHints
}
```
`listSessions(signal?)` returns **deterministic newest-first cloned records** `[VERIFIED: sessionQuery docstring]`.
`SessionSummary` carries **no title**; titles are a separate fold (`readTitle*`), and the UI merges them.

### 1.3 Is a session's agent live / running?

`ctx.agents` `[VERIFIED: inspect]`: `get(id): Agent | undefined`, `list(): Agent[]`, `roots(): Agent[]`, `isOwnedBy(id, owner)`, plus
`currentInitiator()/requireInitiator()/withInitiator/withoutInitiator`, `create/resume/register/enter/announce/setFactory`.
`Agent` also exposes `status: 'idle' | 'running'` and `whenIdle()` (see §3).

So: **live agent** = `ctx.agents.get(sessionId) !== undefined`; **running** = `agent.status === 'running'`.
`SessionRecord.live`/`SessionSummary.agentAvailable` are the same fact from the corpus side.
Do **not** poll `agent/status` for coordination `[README: practices.md:28]` — listen instead (§4).

For a reactive list, two Host events carry the UI's list deltas `[VERIFIED: inspect Event]`:
`'api-session/status'(sessionId, running: boolean)`, `'api-session/activity'(sessionId, updatedAt: number)`,
`'api-session/added'(summary: SessionSummary)`, `'api-session/removed'(sessionId)`.

### 1.4 The current session id

| Where the plugin runs | How to get the session id |
|---|---|
| Tool `execute(args, exec)` | `exec.agent?.id` (`exec.agent.session.append(...)` is the shipped pattern) `[VERIFIED: dsh-tool-todo/lib/index.js]` |
| Handler registered on `agent.ctx` (from an `agent/created` listener) | the `agent` you captured; or `scopeOf(ctx).id` with `scopeOf` from `@deepseek-ai/dsh-scope` `[VERIFIED: dsh-scope exports]` |
| Arbitrary Host callback | `ctx.agents.currentInitiator()?.id` — process-local AsyncLocalStorage attribution, defined only inside a driver chain `[VERIFIED: service method + README: "process-local"]` |

There is **no** `ctx.session` on a plain plugin context; a Host plugin is not session-scoped. Keep your own
`Map<SessionId, Agent>` filled from `agent/created` / `agent/disposed`.

### 1.5 ⚠ Cost warning for titles

`readTitleSnapshots(ids)` folds `session/title` from each session's **complete log** (`projectMany` →
`readColdSessionLog` per id, with a bounded worker pool) `[VERIFIED: dsh-session-query/lib/index.js:168-284]`.
For a catalogue of N sessions that is N full log reads. Result item shape, confirmed:

```ts
{ sessionId: SessionId, status: 'fulfilled', value: { session: SessionHeader, title?: SessionTitleSnapshot } }
| { sessionId: SessionId, status: 'rejected', reason: unknown }        // per-id isolation; cancellation rejects all
```

**Cheap alternative — the persisted projection cache (zero I/O)** `[VERIFIED: inspect sessionProjectionCache]`:

```
ctx.sessionProjectionCache.cachedSnapshot(meta: SessionHeader, keys?: string[]): ProjectionSnapshot | undefined
ctx.sessionProjectionCache.cachedPredecessorTitle(meta: SessionHeader): ProjectionSnapshot | undefined
// ProjectionSnapshot = { asOfSeq: SessionSeq | -1, values: Partial<SessionProjectionMap> }
```
It "serves the cached rows for a session header" from the `session_projcache` domain and checkpoints live sessions on
`turn/end`, creation, disposal and a throttled write-behind, so it is at most one turn stale.
A cached record's rows `[VERIFIED: read `…\.dsh\storages\session_projcache\sessions\<id>.json`]`:
`title {ver,seq,val}`, `titleInput`, `turnOutline` (per-turn `{turn, seq, prompt: <220-char preview>, response: <draft>}`),
`sessionListMetadata {blank, lastPromptAt}`, `sessionStats`, `tokenUsage`, `contextPressure`, `agentPreset`,
`workingDirectory`, `permissions`, `todos`, `plan`, `goal`, `agentTeam`, `inbox`, `modelSelection`, `turnBoundary`…
Layout: `{version, record: {identity: {formatVersion, createdAt, cwd, isSeeded, inheritedEventCount}, rows: {<key>: {ver, seq, val}}}}`.

So the **recommended catalogue** is:
`ctx.workspaceRegistry.list()` (structure/order) + `ctx.sessionQuery.listSessions()` (headers, newest-first) +
`ctx.sessionProjectionCache.cachedSnapshot(header, ['title','sessionListMetadata'])` (titles, zero I/O) +
`ctx.agents.get(id)?.status` (live/running). Fall back to `readTitleSnapshots` only for the sessions you are about to
display in detail.

### 1.6 Sketch — the conversation catalogue (cheap path)


```js
// Host plugin, plain ESM. inject: ['workspaceRegistry','sessionQuery','agents'] (or ctx.inject([...], cb))
export async function listConversations(ctx) {
  const workspaces = ctx.workspaceRegistry.list()          // ordered by the registry's display order
  const records = await ctx.sessionQuery.listSessions()    // newest-first, includes persisted sessions
  const cache = ctx.get('sessionProjectionCache')          // optional service

  return records.map(record => {
    const header = record.header
    const agent = ctx.agents.get(header.id)
    const ws = workspaces.find(w => w.sessionIds.includes(header.id))
    const cached = cache?.cachedSnapshot(header, ['title', 'sessionListMetadata'])   // zero-I/O
    const title = cached?.values?.title                                  // the viewed projection value (a string)
    const listMeta = cached?.values?.sessionListMetadata                 // {blank, lastPromptAt}
    return {
      id: header.id,
      title: typeof title === 'string' ? title : null,
      workspaceId: ws?.id ?? null,
      workspaceTitle: ws?.title ?? null,
      cwd: header.cwd ?? null,
      createdAt: header.createdAt,
      updatedAt: listMeta?.lastPromptAt ?? null,                         // null until the first prompt
      parentSessionId: header.parentSession ?? null,
      live: agent !== undefined,
      running: agent ? agent.status === 'running' : false,
      archived: ctx.workspaceRegistry.archivedSessionIds.includes(header.id),
      pinned: ctx.workspaceRegistry.pinnedSessionIds.includes(header.id),
    }
  })
}
```
Notes:
- `cachedSnapshot(...).values.title` is the **projection value** (a string), while the stored row is `{ver, seq, val}`;
  `asOfSeq` (`-1` = no usable row) tells you how stale the block is. Treat a `-1`/missing row as "no title yet".
- There is **no** `updatedAt` in `SessionHeader`; the list's `updatedAt` comes from `SessionListMetadata.lastPromptAt`
  (cached row) or `SessionSummary.updatedAt` from `ctx.sessionController.list()`. Prefer
  `ctx.sessionController.list({}, signal)` when you need the exact numbers the sidebar shows
  (`running`, `agentAvailable`, `updatedAt`, `blank`, `cwd`, `parentSessionId`).
- `archived`/`pinned` are registry getters (`dsh-workspace/lib/index.js:506,568`); the session list already excludes
  archived sessions in the UI, so decide explicitly whether your graph shows them.

---

## 2. Reading another conversation's recent content

### 2.1 The event vocabulary you need (exact)

```ts
type SessionEvent<T> = { type: T; seq: SessionSeq; time: number /* epoch ms */; data: SessionEventMap[T]; ignorable?: true } & (surface intent)
interface SessionEventMap {
  'turn/start': { turn: number }
  'turn/end':   { turn: number; reason: TurnEndReason }
  'user/message': UserMessage                                   // data IS the message
  'assistant/message': { turn: number; step: number; message: AssistantMessage
                         stream: AssistantStreamRecord[]; usage?: TokenUsage; interrupted?: true }
  'tool/call':   { turn; step; callId: ToolCallId; name: string; arguments: string }
  'tool/result': { turn; step; message: ToolResultMessage; error?: {name, code, reason?}; meta?: JsonValue }
  'system/message': { turn; step; message: SystemMessage }
  'developer/message': { turn; step; message: DeveloperMessage; headerSeq?: SessionSeq }
  'agent/inbox/spliced': { target: InboxTarget; start: number; removedCount?: number; inserted: UserMessage[]; outcome?: 'canceled' }
  'session/title': SessionTitleEventData
  // …plus compaction/*, request/header, approval/*, goal/change, schedule/change, team/*, workspace/changes, todo/write …
}
interface MessageBase { readonly id: MessageId; readonly content: readonly ContentBlock[]; readonly source: MessageSource }
interface UserMessage extends MessageBase { readonly role: 'user' }
interface AssistantMessage extends MessageBase { readonly role: 'assistant'; readonly source: ModelMessageSource }
type ContentBlockMap = { 'text': {type:'text'; text:string}; 'reasoning': {type:'reasoning'; text:string}; 'image': …; 'file': …;
                         'tool-call': {type:'tool-call'; id; name; arguments:string}; 'tool-addition': …; 'tool-removal': … }
type SurfaceEventType = 'system/message'|'developer/message'|'user/message'|'assistant/message'|'tool/result'
```
`[VERIFIED: typert metadata in dsh-agent-preset-registry/lib/typert.host.js; identical to inspect `sessionQuery` referencedTypes]`

`surfaceOp` matters: a compaction appends `replace` intents that **shadow** older nodes. The cheap way to skip shadowed
content is `readSurface`, which returns only the **current** surface nodes; the raw log (`readSession`) still contains the
shadowed ones.

### 2.2 Cost of each read path `[VERIFIED: dsh-session-query/lib/index.js]`

| Call | Implementation | Cost |
|---|---|---|
| `ctx.sessionQuery.readSurface(sessionId)` | `_corpus.load(id)` + `currentSurfaceEvents(...)` (line 1168) | reads the whole raw log (or the live log), **no** Session instantiation, no projection, no model |
| `ctx.sessionQuery.readSession(sessionId)` | `_corpus.load(id)` then a discard-only `Session.create(...)` for replay validation (line 1081) | same read + one throwaway validation instance |
| `ctx.sessionQuery.listEvents(sessionId)` | load + `eventRecords()` (line 1143): `{sessionId, seq, type, time, surface}` — **no payloads** | same read, cheapest clone |
| `ctx.sessionQuery.readEvent({sessionId, seq, before, after})` | load + window slice (line 1210) | same read, bounded clone |
| `ctx.sessionQuery.observeSession(id, opts)` | resolves live → else `sessionPersistence.stat` + **`ctx.sessions.prepare(id, {seed…})`** (line 350-397), caches ≤5 | **heaviest**: registers a prepared Session in the store |

**There is no tail-only API.** Every read loads the full log for a persisted session; there is no "last N events"
persistence primitive (`sessionPersistence.stat` returns only `{header, revision}`). Practical mitigation: cache per
session-id keyed by `readSession`'s last `seq`, and prefer `readSurface` (small result) over `readSession`.

Reading an inactive session does **not** require resume/open of an agent: nothing in `readSession`/`readSurface` touches
`ctx.agents`. Only `observeSession` "prepares" (loads) a Session object.

### 2.3 The function sketch you asked for

```js
/** @returns {Promise<{role:'user'|'assistant', text:string, at:number, turn?:number, step?:number, id:string}[]>} */
export async function recentTurns(ctx, sessionId, limit = 10) {
  const { events } = await ctx.sessionQuery.readSurface(sessionId)   // current surface only
  const turns = []
  for (const ev of events) {
    if (ev.type === 'user/message') {
      turns.push({ role: 'user', text: textOf(ev.data.content), at: ev.time, id: ev.data.id })
    } else if (ev.type === 'assistant/message') {
      const { message, turn, step } = ev.data
      turns.push({ role: 'assistant', text: textOf(message.content), at: ev.time, turn, step, id: message.id })
    }
  }
  return turns.slice(-limit)
}
const textOf = (blocks) => blocks.filter(b => b.type === 'text').map(b => b.text).join('\n')
```
Notes:
- `ev.time` is epoch **ms** (`number`), not an ISO string.
- Filter `b.type === 'text'` only: `reasoning` blocks are also `{type,text}` but are model-private; `tool-call` blocks have `arguments` as a JSON **string**.
- If you need the *whole* conversation including tool calls and pre-compaction history, use
  `readSession` and fold with the same `surfaceOp` logic (`current` surface = `'append'` nodes minus `'replace'` ranges),
  or ask `filterEvents(sessionId, [{kind:'type', values:['user/message','assistant/message']}])`
  → `SessionEventSearchDocument` (record + `text`). `[VERIFIED signatures]`

### 2.5 Cheapest possible content: the cached `turnOutline`

For a graph/overview you often do not need full message text, only "what was asked and what came back" per turn. The
projection cache already stores exactly that `[VERIFIED: `…\session_projcache\sessions\<id>.json`, key `turnOutline`, ver 2]`:

```json
"turnOutline": { "ver": 2, "seq": 766, "val": {
  "turns": [ { "turn": 1, "seq": 5, "prompt": "You are a research scout for the DSH (DeepSeek Ha…", "response": "" } ],
  "draft": "Now I'll write the deliverables." } }
```
Read it with `ctx.sessionProjectionCache.cachedSnapshot(header, ['turnOutline'])` — **zero I/O**, no log replay, at most
one checkpoint stale. `sessionListMetadata.lastPromptAt` gives recency; `sessionStats.lastTurn` gives the turn count.
Use `readSurface` only when you need exact text/seqs (e.g. before handing content to another model).

### 2.6 Reading a *live* session

If `ctx.agents.get(sessionId)` exists, `agent.session` is the live `Session`:
`session.id`, `session.header`, `session.seq`, `session.surface`, `session.deriveMessages()`,
`session.append(type, data, opts?)`, and `eventAt`/`snapshotEvents`/`ownEvents` (**deprecated for new production calls**
`[README: dsh-session/README.md:62]`). Prefer `ctx.sessionQuery` even for live sessions — it is live-preferred by design
("live-preferred logical session", `live()` branch at `dsh-session-query/lib/index.js:354-360`).

---

## 3. Delivering data into another conversation

### 3.1 Exact `Agent` declaration

```ts
export interface Agent {
    readonly id: SessionId;
    readonly options: AgentOptions;
    readonly session: Session;
    readonly inbox: Inbox;
    readonly status: AgentStatus;                 // 'idle' | 'running'
    readonly ctx: Context;                        // agent-scoped registration context
    cancel(cause: AgentCancelCause, options?: CancelOptions): void;
    whenIdle(): Promise<void>;
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
    send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
    followup(message: UserMessage): void;
    steer(message: UserMessage): void;
    inject(message: UserMessage): void;
}
export type AgentStatus = 'idle' | 'running'
export type InboxTarget = 'next-turn' | 'next-step'
export interface CancelOptions { keepInbox?: boolean | undefined }
export interface AgentOptions { provider?: string; model?: string; reasoningEffort?: ReasoningEffortId; maxTokens?: number; subagentDepth?: number }
export type AgentCancelCause = {kind:'user'}|{kind:'parent'}|{kind:'hook';reason:string}|{kind:'disposed'}
export interface Inbox {
  readonly nextTurn: readonly UserMessage[]; readonly nextStep: readonly UserMessage[];
  clear(): void; append(target: InboxTarget, message: UserMessage): void; prepend(...): void;
  replace(messageId, newMessage): boolean; remove(messageId): boolean;
  splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[]
}
export interface MessageBase { readonly id: MessageId; readonly content: readonly ContentBlock[]; readonly source: MessageSource }
export interface UserMessage extends MessageBase { readonly role: 'user' }
```
Source: typert metadata of `@deepseek-ai/dsh-agent` shipped inside `dsh-agent-preset-registry/lib/typert.host.js` `[VERIFIED]`.

`AgentHandle` = `{ agent: Agent; dispose(): Promise<void> }` — `[README: dsh-agent/README.md "the only object that can tear that agent down"; the type itself was not present in the extracted metadata → **UNVERIFIED field names**]`.

### 3.2 inject vs steer vs followup — exact semantics

Identity in the implementation `[VERIFIED: dsh-agent-loop/lib/index.js:800-814]`:

```js
// dsh-agent-loop/lib/index.js:800-814 — quoted verbatim
send(message, target, wakeup) {
  const wakingAfterAbort = wakeup && this.phase.kind !== "idle" && this.phase.abort.signal.aborted;
  const resolvedTarget = wakingAfterAbort ? "next-turn" : target;
  this.inbox.splice(resolvedTarget, Infinity, 0, [message]);
  if (wakeup) this.wakeDriver(wakingAfterAbort);
}
followup(input) { this.send(input, "next-turn", true); }   // ordinary next-turn prompt, WAKES the driver
steer(input)    { this.send(input, "next-step", true); }   // next step of the current turn, WAKES
inject(input)   { this.send(input, "next-step", false); }  // model-facing context, DOES NOT wake
cancel(cause, options = {}) {                              // :815
  if (!options.keepInbox) { this.inbox.clear(); if (this.phase.kind !== "idle") this.phase.wakeRequested = false; }
  if (this.phase.kind !== "idle") this.phase.abort.abort(cause);
}
```

| | inbox list | wakes model? | when the model sees it | durable footprint |
|---|---|---|---|---|
| `followup(msg)` | `next-turn` | **yes** (opens a turn if idle) | the newly opened turn's admitted step | `agent/inbox/spliced` (+ later a `user/message`) |
| `steer(msg)` | `next-step` | yes | the next admitted step of the running turn | `agent/inbox/spliced` |
| `inject(msg)` | `next-step` | **no** → can sit in the inbox indefinitely | whenever some other input admits a step | `agent/inbox/spliced` |

`inject` is logged as `agent/inbox/spliced` at call time and enters the next admitted step `[README: practices.md:18]`.
If you deliver data and the target must act on it, use `followup`. Use `inject` only for passive context that a later
turn may or may not read.
Caveat from the driver: when the target is idle and you `followup`, a turn opens; if the target is aborting, a waking
`next-step` send is reclassified to `next-turn` (line 801-802).

### 3.3 Message construction — `createUserMessage` is required

`followup/steer/inject` take a **complete identified `UserMessage`**, not `{content, source}`. The inbox normalizes only
splice positions and rejects duplicate `id`s; it does not mint ids `[VERIFIED: dsh-agent-loop/lib/index.js:190-204]`.
So:

```js
import { createUserMessage, createDeveloperMessage } from '@deepseek-ai/dsh-llm'
// createMessage → deepFreeze(structuredClone({...input, id: brandString(randomUUID())}))  [VERIFIED: dsh-llm/lib/index.js:36-63]

const msg = createUserMessage({
  content: [{ type: 'text', text: 'Handoff from session B: …' }],
  source: { kind: 'agent-message', form: 'relay', senderSessionId: mySessionId },
})
```
`AgentMessageSource` is the intended provenance for machine-to-machine delivery `[VERIFIED: type]`, and the shipped
subagent package builds exactly it `[VERIFIED: dsh-subagent/lib/index.js:444-449,458]`:
```js
function agentMessageSource(sender) { return { kind: 'agent-message', form: 'relay', senderSessionId: sender.id } }
```
`MessageSourceMap` also offers `{kind:'user'}` (would impersonate a human — avoid), `'subagent-settled'`,
`'team-message'`, `'schedule'`, `'session-reference'`, etc. `dsh-client-ui-chat` has an explicit
`case "agent-message":` branch, so the UI renders it as a distinct source `[VERIFIED: grep]`.

### 3.4 Getting an Agent for a session id, and the no-live-agent case

```js
const target = ctx.agents.get(sessionId)          // Agent | undefined
if (target) {
  target.followup(msg)                            // durable inbox splice on the TARGET session log
} else {
  // No live agent. Options, in order of preference:
  // 1) wake it through the session controller (creates/resumes an agent for that session)
  // 2) write a file/domain record the target reads on next activation
  // 3) do nothing and let the user open the conversation
}
```
`ctx.agents.get(id)` returns a **bare `Agent`** (not the handle) for any live agent, including subagents
`[README: dsh-agent "Ownership invariants"]`. There is **no** supported way to push into a dead session's inbox:
the inbox is a Session-log projection whose commands are driven by a live `ReactLoopInbox` — constructing it requires
the loop's projection registration. `[VERIFIED: ReactLoopInbox.current() throws when the `inbox` projection registration is not active]`

Non-live delivery primitives that do exist, if you need them:
- `ctx.sessionController.prompt(request: SessionPromptRequest, signal): Promise<SessionPromptValue>` — a
  `@Remote('prompt')` method that forwards to the controller's internal command path with a **user** source
  (`{kind:'user', rpcId, clientTimeZone?, principal?}`), resuming a cold Agent first
  `[VERIFIED: dsh-api-session-controller/lib/index.js:3218-3230 and `@Remote` signature list; it is the Client's
  entry, not a plugin contract — see UNVERIFIED #7]`. There is **no** plugin-facing "prompt a session by id" service;
  `ctx.commands` is the human slash-command registry (`register/list/find/execute`), not a prompt sender
  `[VERIFIED: inspect commands]`.
- `ctx.subagents.sendMessage(sender, targetId: SessionId, content: ContentBlock[], {signal})` — but this is the
  *subagent* seam (published children / delegation), not a general cross-session bus. `[VERIFIED signature; scope per README]`
- Write a durable artifact (see §6) that the target's next turn discovers.

---

## 4. Coordination triggers: when does a turn end?

### 4.1 Two families of events

**(a) Session-log facts** — dispatched with `this: Scoped<Session>` on the `session/event` feed, **post-commit and
fire-and-forget** `[VERIFIED: inspect Event: "'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void";
dsh-session/lib/index.js:1587]`. `event.type` is one of `SessionEventMap` above; the interesting ones:

| event.type | payload | why |
|---|---|---|
| `turn/end` | `{turn: number, reason: TurnEndReason}` | **the durable turn boundary**; `TurnEndReason` = `{kind:'completed'}` \| `{kind:'aborted', reason: TurnEndCancelCause}` \| `{kind:'blocked'}` \| `{kind:'error', error: LlmFailure}` \| `{kind:'max-tokens'}` \| `{kind:'interrupted'}` \| `{kind:'forked'}` |
| `assistant/message` | `{turn, step, message, stream, usage?, interrupted?}` | one committed model answer (assistant text) |
| `tool/result` | `{turn, step, message, error?, meta?}` | one call outcome; not a turn boundary |
| `step/end` | `{turn, step}` | step granularity |
| `agent/inbox/spliced` | splice record | your own deliveries appear here |

**(b) Live agent events** — dispatched with `this: Scoped<Agent>` `[VERIFIED: inspect + dsh-agent/lib/types/dispatch.js]`:

| event | mode | signature / payload | notes |
|---|---|---|---|
| `agent/turn-stopping` | serial (awaited) | `({agent, turn, signal}) => Promise<void>\|void` | fires **before** an otherwise-completed turn closes; "can steer to keep it open" `[README: dsh-agent]`; dispatched at `dsh-agent-loop/lib/index.js:1001` |
| `agent/created` | serial (awaited) | `({agent, source, signal?})` | where you obtain `agent.ctx` for per-agent registration |
| `agent/disposed` | emit | `({agent})` | after quiescence, before session detach |
| `agent/status` | emit | `({agent, status})` | `idle` ⇄ `running` — observe, do not poll |
| `agent/assistant-stream` | emit | `({agent, frame})` | live tokens; presentation only |
| `agent/error`, `agent/inbox/{inserted,claimed,discarded}`, `agent/pre-step`, `agent/request`, `agent/request-error` | various | — | hooks |

**Answer to "which is the durable event to react to":** `turn/end` (as a `session/event` type). `assistant/message` is
the right one for "a complete assistant answer landed"; `tool/result` is per-call and must not be used as a turn
boundary. `agent/turn-stopping` is the only hook that lets you add input *inside* the closing turn — it is serial and
awaited, so keep it fast and re-entrancy-safe.

### 4.2 Scoping a listener to one session / agent

`dsh-scope` semantics `[README: dsh-scope]`: "`scopeTarget(base, key)` builds the opaque carrier a scope-filtered event
dispatches with. **Untagged listeners stay global**; a listener tagged with `key` receives events for that key and its
descendants." Therefore:

- **`agent/*` events** — register on the agent's own context and you are properly scoped:
  `agent.ctx.on('agent/turn-stopping', …)`. A plain-plugin-context listener is global and must filter by id
  (shipped example: `dsh-workspace-changes/lib/index.js:1067` listens globally).
- **`session/event`** — the carrier is the *Session* target, which is **not** a descendant of the agent scope, so a
  listener on `agent.ctx` still receives **every** session's events. Filter explicitly by identity — this is exactly
  what the loop itself does `[VERIFIED: dsh-agent-loop/lib/index.js:976-978]`:
  ```js
  const stop = agent.ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type !== 'turn/end') return
    ...
  })
  ```

### 4.3 Recommended coordination pattern (per-agent, plugin-owned disposal)

```js
const disposers = new Map()   // SessionId -> () => void

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.on('agent/created', ({ agent }) => {
      const dispose = agent.ctx.effect(() => {
        const offSession = agent.ctx.on('session/event', (session, event) => {
          if (session.id !== agent.id) return
          if (event.type === 'turn/end' && event.data.reason.kind === 'completed') {
            onTurnCompleted(ctx, agent, event.data.turn)
          }
        })
        // reentrant variant: add input while the turn is still open
        const offStopping = agent.ctx.on('agent/turn-stopping', async ({ agent: a, turn }) => {
          await maybeHandoff(ctx, a, turn)
        })
        return () => { offSession(); offStopping() }
      })
      disposers.set(agent.id, dispose)
    })
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
      disposers.get(agent.id)?.()
      disposers.delete(agent.id)
    })
    return () => { off(); offDisposed(); for (const d of disposers.values()) d(); disposers.clear() }
  })
}
```
Discipline required by the skill `[README: practices.md:8,19]`: "A registration on another context, such as `agent.ctx`,
has two owners: keep its disposer in your plugin's own effect too, so either teardown removes it." The code above does
that. Also: an `agent/created` listener must **not** await `whenIdle()` or its own disposal `[README: dsh-agent limits]`.

---

## 5. Tool registration — `ctx.tools.register(defineTool({...}))`

`ctx.tools.register(definition: ToolDefinition): () => void` `[VERIFIED: inspect]`.
`defineTool` accepts exactly these fields `[VERIFIED: dsh-tools/lib/index.js:840-884]`:

```ts
interface ToolSchema { deferLoading?: true; name: string; description: string; parameters: Record<string, unknown> }
defineTool(options: {
  name: string; description: string
  parameters: Record<string, ValueSchemaSpec>            // the dsh-tools DSL, compiled by valueSchemaSpecToJsonSchema()
  output: {
    schema: ValueSchemaSpec | JsonSchemaNode             // entity/array/object allowed here
    render(args: unknown, value: JsonValue): ContentBlock[]
    presentationMeta?(args: unknown, value: JsonValue): JsonValue
  }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  projectContent?(exec, result): ContentBlock[] | undefined
  finalizeContent?(exec, result): ContentBlock[] | undefined
  presentCall?(args: unknown): ToolCallView | undefined                 // note: args only
  presentResult?(args: unknown, result: unknown): ToolResultView | undefined
  isConcurrencySafe?(args: unknown): boolean
  timeoutMs?: number                                                    // positive finite; declarative only
})
```
**Schema dialect answer (asked explicitly):** the model-facing `parameters` **and** `output.schema` use the same
`dsh-tools` `ValueSchemaSpec` DSL — per-property `required: true`, `additionalProperties`, `items`, `enum`, `oneOf` —
and both are compiled to JSON Schema by `valueSchemaSpecToJsonSchema()` (`parameters` at registration, `output.schema`
at line 849) `[VERIFIED: dsh-tools/lib/index.js:849, dsh-tool-todo/lib/index.js]`. It is **not** schemastery and **not**
zod. Schemastery (`import z from '@deepseek-ai/schemastery'`) is the plugin **Config** dialect; zod is what
`ctx.sessionProjections.register({stateSchema, wire})` and `defineDomain` use.

`ToolRunContext` members were not recoverable verbatim (dsh-tools declarations are absent from the typert metadata);
the shipped tools use `exec.agent`, `exec.signal`, `exec.callId`, `exec.name` `[VERIFIED: dsh-tool-todo, dsh-tool-jobs]`;
the rest is **UNVERIFIED**.
`deferLoading`, `timeoutMs`, `projectContent`, `finalizeContent`, `presentCall`, `presentResult` are copied onto the
registered tool only when supplied (lines 864-884).

### 5.1 Minimal verified example (adapted from `@deepseek-ai/dsh-tool-todo`, shipped `lib/index.js`)

```js
import z from '@deepseek-ai/schemastery'          // only for Config
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'conv-graph'
export const inject = ['tools', 'sessionQuery', 'agents']
export const Config = z.object({ maxTurns: z.natural().default(10) })

export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'conversation_graph_lookup',
    description: 'Read the last N turns of another conversation. Returns id/role/text/at per turn.',
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Target Session id.' },
      limit: { type: 'integer', description: 'How many turns; defaults to the plugin config.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          turns: { type: 'array', required: true, items: {
            type: 'object', additionalProperties: false,
            properties: {
              role: { type: 'string', required: true, enum: ['user', 'assistant'] },
              text: { type: 'string', required: true },
              at: { type: 'number', required: true },
            } } },
        },
      },
      render: (_args, value) => [{ type: 'text',
        text: value.turns.map(t => `${t.role}: ${t.text}`).join('\n') || '(no turns)' }],
    },
    async execute(args, exec) {
      // exec.agent?: Agent, exec.signal, exec.callId, exec.name are the fields used by the shipped tools
      const turns = await recentTurns(ctx, args.sessionId, args.limit ?? config.maxTurns)
      return { turns }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Read conversation', kind: 'read', rawInput: args }),
  }))
}
```
Notes:
- `execute` must return exactly the declared JSON value; the registry validates arguments before the body and turns
  invalid input into a normal error result `[README: dsh-tools:34]`.
- `execute` receives `exec.signal` — cooperative cancellation; honour it.
- `exec.agent` is `Agent | undefined`; the shipped `todo_write` throws when it is absent.
- `timeoutMs` on the definition is **declarative only**; enforcement needs `@deepseek-ai/dsh-tool-call-timeout-policy` `[README: dsh-tools:235]`.
- To hide/deny: `ctx.tools.restrict({allow|deny})`, `ctx.tools.guard(exec => reason|undefined)`.

---

## 6. Persisting a small JSON document across restarts

### 6.1 Recommended: the storage domain form (works in this profile)

`ctx.storageDomain` and `ctx.storage` are live services `[VERIFIED: inspect]`; the profile mounts the whole stack
`[VERIFIED: dsh-base/cordis.patch.yml:179-190]`:

```yaml
- id: storage
  name: '@deepseek-ai/dsh-storage'
- id: storage-json
  name: '@deepseek-ai/dsh-storage-json'
  config: { root: !!js dshHomePath('storages') }
- id: storage-domain
  name: '@deepseek-ai/dsh-storage-domain'
  config: { backend: json }
```
Observable proof: `C:\Users\Administrator\.dsh\storages\workspace.json` and `…\session_projcache\sessions\*.json` exist.

API `[VERIFIED: inspect + dsh-storage-domain/README.md:36-58]`:
- `defineDomain({name, version, tables: {t: domainTable(zodRecordSchema)}})`, exported by the owning package; fails
  loudly at module load on a bad name/version or a `global` schema accepting `null`.
- `await ctx.storageDomain.open(spec): Promise<Domain<S>>` — validates every stored record at open, reads are
  **synchronous from memory**, writes are **durable before they resolve**, each write emits `domain/changed`
  (emitted after durability; a throwing listener cannot reject the write).
- Handle: `domain.table(name).get(id)` (sync), `.put(id, value)`, `.update(id, fn)` (fn runs at its chain slot →
  race-free RMW), `.delete(id)`, plus a global singleton; `domain.close()`.
- Errors carry stable codes: `already-open`, `facet-unsupported`, `invalid-record`, `missing-key`, `closed`,
  `backend-not-found`, `version-mismatch`.

```js
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const graphSpec = defineDomain({
  name: 'convgraph',              // unique domain name == the unit file name: $DSH_HOME/storages/convgraph.json
  version: 1,
  tables: { graphs: domainTable(z.object({
    id: z.string(), title: z.string(), nodes: z.array(z.object({ sessionId: z.string(), role: z.string() })), updatedAt: z.number(),
  })) },
})

export function apply(ctx) {
  ctx.effect(() => {
    let domain
    const ready = ctx.storageDomain.open(graphSpec).then(d => { domain = d })
    return async () => { await ready.catch(() => {}); await domain?.close() }
  })
}
```
Caveats to state to the user: (a) `defineDomain` requires **zod** (and `@deepseek-ai/dsh-storage-domain`) to be
importable — see §8; (b) a domain name is process-global, so `open()` a second time from the same process throws
`already-open` (hold one handle per plugin instance and route all callers through it); (c) no cross-table transactions,
no indexes, no migration (`version-mismatch` on schema change without a spec version bump); (d) `domain/changed` is
in-process only.

### 6.2 Fallback if the imports are unavailable or you want zero coupling

Write a JSON file yourself. Two supported-ish anchors:
- `process.env.DSH_HOME` (set for every profile-launched process; here `C:\Users\Administrator\.dsh`) + a subdirectory
  such as `storages\convgraph\state.json` — but that collides conceptually with the storage stack.
- The session/working directory: `ctx.workingDirectory.get(session)` / `.defaultDirectory`, or a dot-directory in the
  user's project (`.dsh-plugin-state/conv-graph.json`). Workspace-local state is the least fragile for a *per-project*
  conversation graph, and it is visible/editable by the user.
- Use `ctx.fs` (`writeText(target, content, expected?: FsWriteIntent, signal?, sandboxPolicy?)`, `readText`, `stat`,
  `listDir`, `resolve`) rather than `node:fs` so the sandbox policy and file-version guard apply `[VERIFIED: inspect fs service]`.
  `ctx.fs.writeText` returns an `FsWriteOutcome`; pass `{version}` from a prior stat for optimistic concurrency
  (`FS_STALE_VERSION` on conflict).

**Recommendation:** use `ctx.storageDomain` when the plugin can import `@deepseek-ai/*`; otherwise a JSON file under the
workspace (`.dsh-plugin-state/`) written through `ctx.fs`. Do **not** append custom session events: a new event `type`
without `ignorable: true` makes the Session refuse to reopen, and `appendPluginRecord()` is reserved for DSH's
experimental packages `[README: practices.md:21, dsh-session/README.md:66-76]`.

---

## 7. HTTP route + auth

### 7.1 Registration

`ctx.webServer` `[VERIFIED: inspect]`: `register(route: WebRoute): () => void`, `registerUpgrade`, `registerFallback`,
`getOrigin(): string`, `tapIndex`, `renderIndex`, `applyIndexTaps`.

```ts
export type WebRouteKind = 'exact' | 'prefix'
export interface WebRoute {
  kind: WebRouteKind
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```
Source: `dsh-host-webserver` service contract via `cordis_inspect_query`.
⚠️ The inspect output resolved `ServerResponse` against a **same-named, unrelated** type from the connection package
(`{type:'server-response', rpcId, result}`). The real intent is `node:http`'s `IncomingMessage` / `ServerResponse`
`[README: dsh-host-webserver "a `node:http` server"]`. Treat the pair as node http types (or write plain JS and skip types).

```js
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/convgraph',
    async handler(req, res) {
      if (req.method === 'GET' && req.url === '/convgraph/state') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(await currentGraph(ctx)))
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found')
    },
  }))
}
```
Matching order is fixed: **exact table over the whole table → longest prefix → the one fallback** (the SPA dist server)
`[README: dsh-host-webserver:61-65]`. A duplicate `(kind, path)` **throws** — collisions are composition errors.
Route removal on unload: `register()` returns the disposer; wrapping it in `ctx.effect(() => …)` ties removal to the
plugin fiber `[README: host-plugin.md:64 "Register every resource inside `apply` with `ctx.effect` or `ctx.on` and return its cleanup"]`.

### 7.2 Auth finding (the important part)

> **`dsh-host-webserver` performs no server-wide authentication or origin policy** — quoted limitation:
> "**No server-wide authentication or origin policy** — route owners such as `dsh-client-connection` enforce their own
> request policy. Binding a non-loopback address still exposes unprotected routes and static assets to that network."
> `[README: dsh-host-webserver/README.md:130]`

Provider-side detail `[README: dsh-client-connection, "Browser authentication and request trust"]`:
- The launch token (`?token=…`) is accepted **only** on `GET /` (and `/connect` for API peers); that exchange writes an
  authority-bound signed cookie and redirects to clean `./`. "Static assets remain public."
- The signed cookie is required by "every Host RPC method and WebSocket stream" — i.e. the **`/api`** route and the
  `/api/remote.mux` upgrade; `dsh-client-connection` "owns the sole `/api` route".
- Before authentication, requests on **that** route pass a Host/Origin trust fence (loopback / bind-IP / `trustedHosts`,
  `Origin` match, `sec-fetch-site: cross-site` refused). That fence lives in the connection package's request path, not
  in the web server.

**Consequence for the plugin's client-side `fetch()`:** a route registered on a **non-`/api` path** (e.g. `/convgraph/…`)
is *not* authenticated and *not* origin-checked. From the same page (`http://127.0.0.1:13825/`) a plain
`fetch('/convgraph/state')` is same-origin, so it needs **no token, no cookie, no credentials header** — and, being
same-origin, no CORS preflight either. Do **not** add `credentials: 'include'`; it is unnecessary and the cookie is
`Path=/`, `HttpOnly`, `SameSite=Strict` and irrelevant here.

**Security note (must be relayed):** because the carrier does not authenticate custom routes, any local process — and,
subject to browser protections, a page the user visits — can call it. Mitigations, in order of effort:
1. Bind the route to a random per-process path segment and/or require a plugin-minted header secret that the Client
   gets through the boot payload (`ctx.webServer.tapIndex` / an `IndexInjection` `global`).
2. Validate `req.headers.host` is a loopback authority and reject `sec-fetch-site: cross-site` yourself.
3. Keep the handler read-only and side-effect-free where possible.

### 7.3 Handler failure behaviour

"An HTTP request whose handler throws is answered 400 — or the socket destroyed when headers are already out — and
logged as a warning; it never exits the process." `[README: dsh-host-webserver:71]`

---

## 8. ⚠ Import resolution: can a third-party Host plugin `import '@deepseek-ai/…'`? — **UNVERIFIED**

Facts:
- The profile `node_modules` contains only the profile-installed bundles (`.pnpm`, `@local/*`); there is **no**
  `@deepseek-ai` directory: `C:\Users\Administrator\.dsh\profiles\desktop\node_modules` `[VERIFIED]`.
- Both installed `@local` bundles (`workspace-manager` 1.2.0, `project-file-picker` 1.0.1) are **client-only** and
  import **nothing** from `@deepseek-ai`; their Host halves are `export function apply() {}` `[VERIFIED]`.
- A plain Node resolution from a plugin directory fails:
  `node -e "import('@deepseek-ai/dsh-tools')"` from the plugin's real path →
  `ERR_MODULE_NOT_FOUND` `[VERIFIED: tested]`.
- The Cordis loader imports a row's module through `this.ctx.loader.internal.import(name, this.ctx.baseUrl, {})` when an
  internal loader is present, else bare `import(name)` `[VERIFIED: cordis-plugin-loader/lib/index.js:214-228]`. Whether
  the installed `internal` loader resolves bare specifiers against the **dsh installation** was not established here.
- The skill states shipped packages "resolve from the dsh installation, so the bundle declares no dependencies on them"
  — but that sentence is about **rows naming shipped packages**, not about bare imports inside plugin code.
- Independently: `@deepseek-ai/dsh-tools` **is** published publicly (npm `dist-tags.next = 0.2.1-rc.5`, exactly the
  installed version) `[VERIFIED: registry.npmjs.org]`, so a bundle *can* declare
  `"dependencies": {"@deepseek-ai/dsh-tools": "0.2.1-rc.5"}` and let `install_bundle`'s pnpm install it. That yields a
  **second module instance** of the package — harmless for `defineTool` (pure function) but do not rely on module-level
  identity (e.g. `instanceof`, registry singletons) across the boundary.

**Recommendation for the build:** write the first Host version **without any `@deepseek-ai` import** where feasible:
- `UserMessage` → plain object `{ id: crypto.randomUUID(), role: 'user', content: [{type:'text', text}], source }`
  (brands are compile-time only; the log validates lossless JSON, not the brand) `[VERIFIED: "the brands disappear at runtime"]`.
- `ToolDefinition` → plain object `{name, description, parameters, output:{schema, render}, execute}`;
  `defineTool` is sugar over exactly this `[VERIFIED: ToolDefinition type]`. **UNVERIFIED**: whether raw JSON Schema in
  `parameters` is accepted the way the `defineTool` DSL is compiled; safest raw form is to mirror what `defineTool`
  emits (standard JSON Schema object with `type/properties/required[]`).
- `storageDomain` → skip `defineDomain`/zod; use the `ctx.fs` JSON fallback (§6.2), or declare the deps in
  `package.json` and let `install_bundle` install them.
Either way this needs one empirical install (a bundle whose Host half does the import and logs success/failure).

---

## 9. Everything marked UNVERIFIED

1. **`import '@deepseek-ai/*'` from a profile-installed third-party Host plugin** — untested; see §8. Blocks the
   choice between `defineTool`/`createUserMessage`/`defineDomain` and hand-rolled equivalents.
2. **`AgentHandle` field names** — README names `handle.agent` and `await handle.dispose()`; no `.d.ts` present in the
   extracted tree (`lib/types/*.d.ts` are not shipped in the asar extraction; `package.json` "types" points at them).
3. **Raw JSON Schema in `ToolDefinition.parameters`** (bypassing `defineTool`) — the DSL is documented; direct raw
   acceptance is inferred from `ToolSchema.parameters: Record<string, unknown>`.
4. **Full `ToolRunContext` member list** — only `agent`, `signal`, `callId`, `name` are exercised by shipped tools.
5. **Typing of `sessionProjectionCache.cachedSnapshot(meta, keys)`** — `SessionProjectionMap` is an empty interface in
   the base package (plugins declaration-merge into it), so `keys` is `never[]` at the type level; pass string literals
   (`['title']`) from JS or cast. Runtime accepts any registered projection key.
6. **Whether any shipped consumer treats `source.kind === 'agent-message'` specially in the transcript** — the type
   exists and `dsh-client-ui-chat` has a `case "agent-message"` branch; rendering details not inspected.
7. **`ctx.sessionController.*` Remote methods as plugin-facing APIs** — `list`, `prompt`, `create`, `fork`, `rename`,
   `updateQueue`, `cancel`, `page`, `follow`, `projections` are Host service methods (signatures verified), but they are
   the **Client's** contract, take Client-shaped requests (`SessionListRequest`, `SessionPromptRequest`), read
   `ctx.invocation` for the principal, and impersonate a user submission. Calling them from a plugin is technically
   possible and is the only shipped way to wake a cold session; treat as supported-by-observation only.
8. **Behaviour of `agent.inject()` on an idle agent that never runs again** — documented as "can wait in the inbox
   until other input arrives"; whether that pending inbox survives restart is implied by `agent/inbox/spliced` being
   durable, but was not exercised.

---

## 10. Appendix — evidence index

| Claim | Source |
|---|---|
| Service contracts, event names/modes, tool schemas | `cordis_inspect_query` (host `Service`,`Event`,`Tool`) on the live Host |
| `Agent`, `Inbox`, `Session`, `SessionEventMap`, `MessageSourceMap`, `SessionSummary`, `WorkspaceView` declarations | `<pkg>/lib/typert.host.js` typert metadata (verbatim `.d.ts` text) → extracted to `.tmp-probe/b/decls.json` |
| inject/steer/followup implementation | `dsh-agent-loop/lib/index.js:800-814`; inbox dup-id + append `:190-204`; `turn-stopping` dispatch `:1001`; per-agent `session/event` filter `:976-978` |
| `session/event` is post-commit | `dsh-session/lib/index.js:1575-1592` |
| `readSession`/`readSurface`/`observeSession` cost | `dsh-session-query/lib/index.js:350-397, 1064-1176` |
| `readTitleSnapshots` per-id settle shape + full-log cost | `dsh-session-query/lib/index.js:168-284` |
| Projection-cache contract (`cachedSnapshot`, `cachedPredecessorTitle`, `coldSnapshot`) and its `turn/end` checkpoint | `cordis_inspect_query` Service `sessionProjectionCache` |
| Cached row contents (`title`, `turnOutline`, `sessionListMetadata`, …) | `C:\Users\Administrator\.dsh\storages\session_projcache\sessions\*.json` |
| `Workspace` entity surface | `dsh-workspace/lib/index.js:76-160, 506, 568` |
| Storage stack is mounted with backend `json` | `dsh-base/cordis.patch.yml:179-190`; `…\.dsh\storages\workspace.json` |
| No server-wide auth on `webServer` | `dsh-host-webserver/README.md:130` (quoted limitation) |
| Token/cookie only for `/`, `/connect`, `/api`, upgrades; static assets public | `dsh-client-connection/README.md` "Browser authentication and request trust" |
| Tool DSL + `defineTool` example | `dsh-tools/README.md:38-64`; `dsh-tool-todo/lib/index.js` (full file) |
| Plugin authoring rules (effects, agent scoping, no custom events, projections) | skill `cordis-plugin-development` → `references/host-plugin.md`, `references/practices.md`, `references/user-actions.md` |
