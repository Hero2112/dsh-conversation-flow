# 安装 · `@local/dsh-conversation-flow` v1.3.0

本目录（`releases/v1.3.0/`）是一个**完整可安装的插件包**，文件夹名 `conversation-flow`、包名 `@local/dsh-conversation-flow`。

## 安装方式（在 DSH 会话里让 Agent 执行）

```text
plugin_manager
  action: install_bundle
  target: <本目录的绝对路径>\releases\v1.3.0      （或解压出来的 conversation-flow 目录）
```

- 首次安装：直接 `install_bundle` 上面的目录；
- 已装旧版：先 `remove_bundle`（target 用包名 `@local/dsh-conversation-flow`），再 `install_bundle` 新目录；
- 安装成功的标志：返回里 `application: "applied"`、`enabled: true`，且 `GET http://127.0.0.1:13825/conversation-flow/api/state` 的 `diagnostics.tool` 为 `registered`。

## 生效

| 改了什么 | 怎么生效 |
|---|---|
| `client.js`（界面） | 刷新页面（Ctrl+F5）即可 |
| `index.js`（Host） | 在 `plugin_manager` 里停用再启用该插件（或重启 DSH） |
| **安装路径变了**（换目录 / 换 release） | **必须完全退出并重启 DSH**，只刷新页面不够，否则侧边栏图标与面板不会出现 |

## 依赖与运行条件

- 不需要额外 npm 依赖：插件自带全部运行时（React Flow 已内联，`react`/`react-dom` 用 DSH 外壳的共享模块表）；
- 需要 DSH Web GUI（profile `desktop`），侧边栏入口在「插件」「定时任务」之后（`order: 45`）；
- 数据文件：`$DSH_HOME/conversation-flow/graph.json`（`$DSH_HOME` 默认 `~/.dsh`）。

## 卸载

```text
plugin_manager
  action: remove_bundle
  target: @local/dsh-conversation-flow
```

卸载不会删除 `graph.json`，重新安装后画布还原。
