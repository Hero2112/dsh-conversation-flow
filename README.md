# 对话流 · Conversation Flow

基于 **React Flow** 的 DSH 插件：把多个对话放在同一张图上，管理对话之间的**数据传输**与**协调工作**。

## 入口

侧边栏出现一个新的面板图标「对话流」（`sidebar.panellist`），点击后进入主面板页面（keyed `main` slot，panel id `conversation-flow`）。

## 能做什么

| 能力 | 说明 |
|---|---|
| 多主题 | 画布顶部主题条：**切换 / 新建 / 改名 / 删除**主题；一个主题 = 一张独立工作流画布（节点、通道、节点属性、外观都按主题各自保存），等于在一个插件里管理多条工作流 |
| 画布 | React Flow 图：节点 = 对话，连线 = 数据通道；支持拖拽、缩放、平移、小地图、框选 |
| 画布外观 | 右上角「画布」按钮打开设置：**背景色**（7 个预设 + 任意取色，或跟随主题）、**网格线开关**、**网格样式**（点阵/横线/交叉）、**间距**、**网格颜色**（自动按背景明暗取色，也可自选） |
| 建通道 | 从节点右侧圆点拖到另一个节点即可建立通道（同一对对话只允许一条） |
| 节点设置 | 点击节点，右侧面板可编辑 **节点作用**、**输出内容**、**是否定时**（每 N 分钟 1–720）；三者都实际驱动运行：作用决定投给该对话的任务指令、输出决定下游负载、定时决定何时执行；面板显示上次运行/执行中状态并可「立即执行」 |
| 传输内容 | 每条通道可选：**最后一轮回答** / **最近 N 轮** / **完整记录** / **自定义文本** |
| 手动传输 | 节点上的「发送数据」按钮把该节点的所有出口一次推送；检查器里也可单条「立即传输」 |
| 自动协调 | 打开通道的「自动协调」开关后，**源对话每轮结束时**（`turn/end` 且 `reason.kind === 'completed'`）自动把内容推送到目标对话 |
| 定时触发 | 节点开启定时后，Host 每 20 秒扫一次：到间隔就**执行节点**——有「作用」先驱动该对话干活，再把结果（或固定输出）推给全部下游通道 |
| 传输记录 | 画布下方显示最近 40 条传输（成功/失败、字数、时间、来源：手动/自动/定时） |
| 落盘 | 主题与画布保存在 `$DSH_HOME/conversation-flow/graph.json`（v2：`topics[]` + `activeTopicId`），重启后恢复 |
| Agent 工具 | `conversation_flow`（action: `list` / `topics` / `topic` / `state` / `node` / `run` / `transfer` / `link` / `coordinate`），与 UI 共用同一份实现 |

## 多主题（v1.4）

**主题 = 一张独立的工作流画布。** 顶部主题条提供：下拉切换、`＋新建主题`、`改名`、`删除`（二次确认，且至少要留一个）。

- 每个主题各自保存：节点、通道、节点的作用/输出/定时、画布外观（背景色/网格）；节点 id 只在主题内唯一。
- **跨主题运行**：定时任务与自动协调遍历全部主题——切到别的工作流时，其它主题的定时节点照样按间隔执行。
- 兼容旧数据：旧版单画布 `graph.json` 会迁移为「默认主题」，节点与连线不丢。
- 接口：`GET /api/state` 返回 `topics` + `activeTopicId`（`graph` 是当前主题）；`POST /api/topic` 传 `{ action: create|select|rename|delete, topicId?, name? }`；`/api/graph`、`/api/node`、`/api/run` 可用 `topicId` 指定主题。

## 数据是怎么"过去"的

传输把源对话日志中的文本打包成一条 **user 消息**投递到目标对话的 Agent inbox：

```
【对话流·最后一轮回答】来自对话「架构讨论」（自动协调）

<源对话正文>
```

- 通过 `agent.followup(message)` 投递：它是 `next-turn` 且会唤醒目标对话，因此目标会真的"收到并开始处理"。
- 消息是一条标准 `user` 消息（`source: { kind: 'user' }`），抬头写明了来源对话与本次负载类型，在目标对话的 GUI 里可读、可追溯。

## 画布外观（v1.1）

画布右上角「画布」按钮打开设置面板，全部即时生效并写进 `graph.json` 的 `canvas` 字段：

```json
{ "bgColor": "#1b2230", "grid": true, "variant": "cross", "gap": 28, "gridColor": "#445566" }
```

| 设置 | 取值 |
|---|---|
| 背景色 | `null` = 跟随 Harness 主题；预设（深墨/石墨/石板/森林/沙色/白）+ 任意自定义颜色 |
| 网格线 | 开 / 关（关掉后仍保留背景色） |
| 网格样式 | `dots` 点阵 / `lines` 横线 / `cross` 交叉 |
| 间距 | 12 / 16 / 22 / 28 / 36 / 48 px |
| 网格颜色 | `null` = 自动（按背景明暗选深/浅网格），也可自选 |

Host 侧会校验并规范化这些值（非法颜色/样式/间距回落到默认），所以直接调 API 写也不会把画布搞坏；只保存节点和连线时不会覆盖已有外观。

## 节点设置：三个字段都真正驱动运行（v1.3）

**点击画布上的节点**，右侧面板从「连线设置」切换为「节点设置」。这三个字段不是备注，它们决定节点**怎么跑**：

### 一次「执行」的完整过程

```
定时到点 / 点「立即执行」/ 工具 run
        │
        ▼
① 有「节点作用」→ 往该节点自己的对话投递任务消息并唤醒它（agent.followup）
      【对话流·节点执行】你在画布中的职责：<role>
      （本次由定时任务触发，间隔 N 分钟）
      → 这条消息会真的让该对话开始干活，轮次结束后回复自动进日志
        │
        ▼
② 同时判断「输出内容」：
      非空 → 立即把这段固定文本推给该节点的所有下游通道（不等对话）
      空   → 进入「执行中 pending」，等这个对话本轮结束（turn/end · completed）
              再把它刚产出的内容推给下游（来源标记「定时触发」）
```

| 字段 | 对运行的实际影响 |
|---|---|
| 节点作用 `role` | 决定执行时**往该对话里投递什么任务指令**（`agent.followup` 唤醒该对话，措辞就是这段作用）。留空则该节点退化为纯数据推送，不驱动对话 |
| 输出内容 `output` | 决定**推给下游的内容**：非空 = 固定文本，立即推送；空 = 取对话产出（按连线类型） |
| 是否定时 `schedule` | 决定**什么时候执行**：开启后 Host 每 20 秒扫描，到 `everyMinutes` 就执行一次；关闭只能手动 / 工具触发 |

配套状态：

- `lastRunAt` / `pendingAt` 都会落盘；`pendingAt` 表示「已驱动、等待该轮产出」，超过 10 分钟自动失效，界面与 `state` 工具都会显示「执行中」。
- 被驱动的对话本轮结束时，先完成节点自己的下游推送，再走全局「自动协调」——两者共用 15 秒防回环，不会重复推两次。
- 目标对话不在线、节点对话没打开、没有下游通道，都只记日志/返回明确错误，不会静默。

节点对象在 `graph.json` 里的样子：

```json
{ "id": "n1", "sessionId": "session-…", "x": 40, "y": 40,
  "role": "架构决策", "output": "",
  "schedule": { "enabled": true, "everyMinutes": 15 },
  "lastRunAt": 1760000000000, "pendingAt": 0 }
```

接口与工具：

- `POST /api/node` 改 role/output/schedule；`POST /api/run` 立即执行（返回 `kicked` / `pending` / `sent` / `failed` / `error`）。
- `conversation_flow` 的 `node`、`run` 两个 action 与 UI 等价；`state` 会输出每个节点的作用、是否固定输出、定时与「执行中」状态。

## 限制（重要）

1. **目标对话必须是打开状态**（该会话有活动的 Agent）。DSH 没有面向插件的"向未打开会话投递"的公开接口；这种情况下传输会返回 `target-not-live`，并提示先在 GUI 打开目标对话。
2. **防回环**：同一对 `源→目标` 在 15 秒内不会重复自动/定时推送；自动协调只响应"完成"的轮次。
3. 传输内容是**文本**（text block），图片/附件不随传输搬移。
4. 路由 `/conversation-flow/api/*` 不在 DSH 的 `/api` 鉴权范围内（携带方没有全局鉴权）；插件自身拒绝 `sec-fetch-site: cross-site` 的请求，且默认只监听 loopback。
5. 被节点驱动的那一轮会**消耗模型额度**（等于你在那个对话里手动发了一条消息），定时频率请按需设置。

## 结构

- `index.js` — Host 半：会话目录读取（`sessionQuery` / `sessionProjectionCache` / `agents`）、投递、自动协调触发（`session/event` → `turn/end`）、HTTP 路由、`conversation_flow` 工具、图定义落盘。
- `client.js` — 浏览器半：`window.__ModuleLoader__.load` 工厂，注册侧边栏图标 + 主面板页面；React Flow 及其纯 JS 依赖已内联，`react` / `react-dom` 使用外壳的共享模块表。
- `client.js` 由 `../build/`（esbuild 构建脚本 + 测试）生成，构建产物不要手改。
- 文案：`locale/zh.json`、`locale/en.json`（插件清单展示用 meta）。页面内文案在 `client.js` 内随 `ctx.locale` 切换。

## 自检接口

`GET /conversation-flow/api/state` 返回的 `diagnostics` 字段给出 Host 半的自检结果：

```json
{ "tool": "registered", "toolError": null, "route": "/conversation-flow" }
```

`tool` 为 `registered` 表示 `conversation_flow` 工具已挂载；`failed` 时 `toolError` 是注册错误原文，`no-service` 表示当前 profile 没有 tools 服务。

## 开发

```powershell
cd ../build
# 依赖（首次）
pnpm install
# 重新生成 ../conversation-flow/client.js
pnpm run build
# 测试：Host 半（mock 服务，31 项）+ 页面服务端渲染（6 项）
pnpm test
```

生效方式：

- **Client 半**（`client.js`）：改完重新 build，刷新 GUI 页面即可。
- **Host 半**（`index.js`）：ESM 模块在进程内缓存，需要 `plugin_manager` 里停用再启用该插件（或重启 GUI）才会加载新代码。
- 图定义与传输记录：`$DSH_HOME/conversation-flow/graph.json`（`$DSH_HOME` 默认 `~/.dsh`）。删除该文件并重新加载插件即可清空画布。

