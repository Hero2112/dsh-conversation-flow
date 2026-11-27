# 对话流 · `@local/dsh-conversation-flow`

> **GitHub 仓库**：https://github.com/Hero2112/dsh-conversation-flow
> **开源，MIT 许可** · [安装说明](INSTALL.md) · [Releases](https://github.com/Hero2112/dsh-conversation-flow/releases)
> **当前版本**：1.4.1 · **最近发布**：2026-11-06
> **安装目录**：`releases/v1.4.1/`（冻结快照，**正在运行的就是它**）· 开发改 `dev/`

DSH（DeepSeek Harness）Web GUI 插件：把多个对话放进 **React Flow** 画布，管理对话之间的**数据传输**与**协调调度**；支持**多主题**——每个主题是一张独立画布，也就是一条独立工作流。

- 侧边栏入口：`sidebar.panellist`（`id: conversation-flow`，排在「插件」「定时任务」之后）
- 主面板：keyed `main` slot（`key: conversation-flow`）
- 数据文件：`$DSH_HOME/conversation-flow/graph.json`（v2：`topics[]` + `activeTopicId`）

## 能力一览

| 能力 | 说明 |
|---|---|
| 多主题 | 顶部主题条：**切换 / 新建 / 改名 / 删除**；一个主题 = 一张独立工作流画布，节点、通道、节点属性、外观都按主题隔离；定时与自动协调跨全部主题运行 |
| 画布 | 节点 = 对话，连线 = 数据通道；拖拽 / 缩放 / 小地图；背景色、网格样式/间距/颜色可换并持久化 |
| 建通道 | 从节点右侧圆点拖到另一个节点建立通道，同一对对话只允许一条 |
| 传输内容 | 最后一轮回答 / 最近 N 轮 / 完整对话记录 / 自定义文本 |
| 手动传输 | 节点「发送数据」、通道「立即传输」、顶部「立即传输」，并有最近 40 条传输记录（来源：手动/自动/定时） |
| 自动协调 | 源对话每轮结束（`turn/end` · `completed`）自动推送到目标对话，15 秒防回环 |
| 节点属性驱动运行 | **节点作用** → 执行时投进该对话的任务指令（真正唤醒它干活）；**输出内容** → 下游固定负载；**是否定时** → 按间隔自动执行 |
| 执行中状态 | `pendingAt` 等待本轮产出，卡片/面板显示「执行中」，本轮结束兑现推送并清除 |
| Agent 工具 | `conversation_flow`：`list / topics / topic / state / node / run / transfer / link / coordinate` |

功能细节、限制与接口见 [dev/README.md](dev/README.md)。

## 目录结构（按插件库规范）

```
插件/conversation-flow/
├── README.md                本文件：插件总述（阅读入口）
├── CHANGELOG.md             版本总表
├── versions/
│   ├── v1.3.0.md            历史版本说明
│   ├── v1.4.0.md            多主题画布
│   └── v1.4.1.md            当前版本：修复启动顺序导致的面板空数据
├── releases/
│   ├── v1.3.0/              历史冻结快照
│   ├── v1.4.0/              历史冻结快照
│   └── v1.4.1/              当前冻结快照：完整可安装包（package.json client.js index.js cordis.patch.yml icon.svg locale/ README.md INSTALL.md）
├── dist/
│   ├── conversation-flow-1.3.0.zip
│   ├── conversation-flow-1.4.0.zip
│   └── conversation-flow-1.4.1.zip   分发包（顶层 conversation-flow/，永不覆盖）
├── dev/                     下一版工作副本（构建产物 client.js 也输出到这里）
└── build/                   esbuild 构建脚本 + 源码 + 测试 + API 参考文档
    ├── src/{client.jsx,page.jsx,shared.js}
    ├── build.mjs            → 输出 ../dev/client.js
    ├── test/{host.test.mjs,render.smoke.mjs}
    └── docs/                Host / Client 接口调研报告
```

## 安装与生效

```text
plugin_manager
  action: install_bundle
  target: <本仓库>\releases\v1.4.1
```

- 已装旧版：先 `remove_bundle`（target `@local/dsh-conversation-flow`），再 `install_bundle` 新目录；
- **安装路径变化后必须完全退出并重启 DSH**（只刷新页面不够），否则侧边栏图标与面板不出现；
- 只改 `client.js`：刷新页面即可；只改 `index.js`：停用/启用插件即可。

> **本机现状**：DSH 里跑的这份是通过 `dsh-plugins/conversation-flow` 安装的，而该目录是一个指向 `插件/conversation-flow/releases/v1.4.1` 的**目录联接（junction）**。这样做是为了让"源码搬进插件库、安装路径保持稳定"，从而**不必重启 DSH** 客户端就能继续显示侧边栏图标与面板；升级新版本时只需把 junction 目标换成新 release 再重装同一路径。

详见 [releases/v1.4.1/INSTALL.md](releases/v1.4.1/INSTALL.md)。

## 开发

```powershell
cd build
pnpm install        # 首次
pnpm run build      # 重新生成 ../dev/client.js
pnpm test           # Host mock 测试 35 项 + 页面服务端渲染测试 7 项
```

发版流程：`dev/` 验证通过 → 整份复制到 `releases/vX.Y.Z/` → 写 `versions/vX.Y.Z.md` → `CHANGELOG.md` 追加 → 打包 `dist/<插件名>-vX.Y.Z.zip` → 让 Agent 安装新 release 目录。

## 提交约定

每次修改**单独提交一次**，提交信息用中文写清楚本次新增/修改了哪些功能；同步更新 `CHANGELOG.md` 与 `versions/`；提交后推送到 GitHub 仓库。
