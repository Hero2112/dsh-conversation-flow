# DSH 对话流插件 · Conversation Flow

DeepSeek Harness（DSH）Web GUI 插件：把多个对话放进一张 **React Flow** 画布，管理对话之间的**数据传输**与**协调/调度**。

- 插件包：`conversation-flow/`（可被 `plugin_manager` 安装，包名 `@local/dsh-conversation-flow`）
- 构建与测试：`build/`（esbuild 打包出 `conversation-flow/client.js`，含两套测试）
- 功能说明与限制：见 [conversation-flow/README.md](conversation-flow/README.md)
- 版本历史：见 [CHANGELOG.md](CHANGELOG.md)

## 能力一览

| 能力 | 说明 |
|---|---|
| 画布 | 节点 = 对话，连线 = 数据通道；拖拽/缩放/小地图；外观可换背景色、网格样式/间距/颜色 |
| 建通道 | 从节点右侧圆点拖到另一个节点建立通道，一对对话只允许一条 |
| 传输内容 | 最后一轮回答 / 最近 N 轮 / 完整对话记录 / 自定义文本 |
| 自动协调 | 源对话每轮结束（`turn/end` · `completed`）自动推送到目标对话 |
| 节点属性驱动运行 | 节点可编辑**节点作用 / 输出内容 / 是否定时**，三者真正影响执行：作用驱动该对话、输出决定下游负载、定时决定何时执行 |
| Agent 工具 | `conversation_flow`：list / state / node / run / transfer / link / coordinate |
| 落盘 | 画布、通道、节点属性、定时状态都在 `$DSH_HOME/conversation-flow/graph.json` |

## 安装到 DSH

```powershell
# 在 DSH 会话里用 plugin_manager 安装本目录下的插件包
#   action: install_bundle
#   target: <仓库路径>\conversation-flow
```

安装后侧边栏出现「对话流」图标；客户端改动刷新页面生效，Host 改动需停用/启用插件（或重启 GUI）。

## 构建与测试

```powershell
cd build
pnpm install      # 首次
pnpm run build    # 生成 ../conversation-flow/client.js
pnpm test         # Host 半 mock 测试 + 页面服务端渲染测试
```

当前基线：Host **31** 项、页面渲染 **6** 项，全部通过。

## 提交约定

以后每次修改代码都会**单独提交一次**，提交信息用中文写清楚本次新增/修改了哪些功能，并同步更新 [CHANGELOG.md](CHANGELOG.md)。
