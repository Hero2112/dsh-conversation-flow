# 变更记录 · CHANGELOG

> 每次修改都单独提交，功能点用中文描述。版本号与插件包 `package.json` 保持一致。
> 仓库：https://github.com/Hero2112/dsh-conversation-flow

## 1.4.0 — 多主题画布（一个主题 = 一条工作流）

- **多主题**：画布顶部新增主题条，可下拉切换、`＋新建主题`、`改名`、`删除`（二次确认；至少保留一个主题）。每个主题是一张独立画布，节点、通道、节点属性、画布外观互不干扰——等于在一个插件里管理多条工作流。
- **跨主题运行**：定时任务、自动协调、pending 兑现遍历**所有主题**，切到别的主题也不影响其它主题的定时节点继续工作。
- **兼容旧数据**：旧版单画布 `graph.json` 自动迁移为一个「默认主题」，节点/通道/外观原样保留；状态文件升级为 v2（`{ version: 2, activeTopicId, topics, transfers }`）。
- **接口**：`GET /api/state` 新增 `topics`（id/名称/节点数/通道数/定时数/更新时间）与 `activeTopicId`；新增 `POST /api/topic`（create/select/rename/delete）；`/api/graph`、`/api/node`、`/api/run` 支持 `topicId`，`/api/coordinate` 按连线自动定位主题。
- **工具**：`conversation_flow` 新增 `topics`、`topic` 两个 action；`state` 先报告当前主题；`node`/`run` 可按节点 id 或 session id 跨主题定位。
- **测试**：Host 35 项（新增默认主题、主题增删改查与画布隔离、非当前主题的定时节点照常触发、工具主题操作）、页面渲染 7 项（新增主题条渲染），全部通过。
- **发布**：`releases/v1.4.0/`、`versions/v1.4.0.md`、`dist/conversation-flow-1.4.0.zip`。

## 1.3.0 — 节点属性真正驱动运行

- **执行语义落地**：节点的「节点作用」不再只是文字。执行节点时会把作用作为任务指令投进该节点自己的对话（`agent.followup` 唤醒它），让对话真的按职责开始工作。
- **输出内容决定下游负载**：填写后该节点总是推送这段固定文本，且立即推送、不必等对话产出；留空则在该轮结束后取对话产出（按连线类型）。
- **执行中状态**：`pendingAt` 记录「已驱动、等待该轮产出」，节点卡片与面板显示「⏳ 执行中」；该轮结束（`turn/end` · `completed`）后自动把结果推给全部下游通道并清除状态。
- **不重复推送**：被驱动轮的推送与全局自动协调共用 15 秒防回环，先推节点、再走自动协调，同一次轮次只发一次。
- **接口与工具**：`POST /api/run` 返回 `kicked/pending/sent/failed/error`；`conversation_flow` 的 `run` 会走同一路径；`state` 输出每个节点的作用、固定输出、定时与执行中状态。
- **仓库归档**：迁入插件库 `插件/conversation-flow/`，按 `releases/` `versions/` `dist/` `dev/` 规范组织；发布快照 `releases/v1.3.0/`、分发 zip `dist/conversation-flow-1.3.0.zip`；GitHub 仓库 https://github.com/Hero2112/dsh-conversation-flow 。
- **测试**：Host 31 项（新增执行驱动、轮次兑现、固定输出直推、定时单窗口一次、工具 run 等）、页面渲染 6 项，全部通过。

## 1.2.0 — 节点可编辑属性

- 点击节点，右侧面板切换为「节点设置」，可编辑 **节点作用**（≤200 字）、**输出内容**（≤8000 字）、**是否定时**（开关 + 每 N 分钟，1–720）。
- 节点卡片显示作用文本与徽标（`✎ 输出内容`、`⏱ 每 N 分钟`）。
- 新增 `POST /api/node`（修改属性）与 `POST /api/run`（立即触发）路由；Host 侧对字段做长度截断、取值钳制与非法值回落。
- `conversation_flow` 工具新增 `node`、`run` 两个 action。
- 写入有 450ms 防抖，轮询刷新不会覆盖正在输入的内容；拖拽节点不会丢失节点属性。
- 测试：Host 30 项、页面渲染 6 项。

## 1.1.0 — 画布外观可配置

- 画布右上角「画布」按钮：**背景色**（跟随主题 + 6 个预设 + 任意取色）、**网格线**开关、**网格样式**（点阵/横线/交叉）、**网格间距**（12–48px）、**网格颜色**（自动按背景明暗取色或自选）、恢复默认。
- 外观持久化到 `graph.json` 的 `canvas` 字段；Host 侧校验颜色/样式/间距，非法值回落默认；只保存节点/连线时不会覆盖已有外观。
- 测试新增外观往返、非法值回落、只存节点不覆盖外观等用例。

## 1.0.0 — 初版

- 侧边栏「对话流」入口 + 主面板 React Flow 画布；节点 = 对话，连线 = 数据通道。
- 四种负载：最后一轮回答 / 最近 N 轮 / 完整对话记录 / 自定义文本。
- 手动传输（节点「发送数据」、通道「立即传输」、顶部「立即传输」）与传输记录（最近 40 条）。
- 自动协调：源对话 `turn/end` 且 `reason.kind === 'completed'` 时自动推送，带 15 秒防回环。
- 传输以标准 `user` 消息经 `agent.followup` 投递到目标对话 inbox，抬头写明来源与负载类型。
- `conversation_flow` Agent 工具（list / state / transfer / link / coordinate）。
- 画布定义落盘 `$DSH_HOME/conversation-flow/graph.json`；HTTP 路由 `/conversation-flow/api/*`（含同源校验、`diagnostics` 自检字段）。
