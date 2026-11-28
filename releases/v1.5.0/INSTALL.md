# 安装 对话流

DSH Web GUI 的客户端插件：侧边栏入口在「插件」「定时任务」之后。

## 1. 下载

到 [Releases](https://github.com/Hero2112/dsh-conversation-flow/releases) 下最新的
`conversation-flow-X.Y.Z.zip`，解压得到一个 `conversation-flow` 文件夹，放固定位置，例如：

```
D:\dsh-plugins\conversation-flow
```

## 2. 让 DSH 装上

对 Agent 说：

> 安装本地插件包，包目录是 `D:\dsh-plugins\conversation-flow`

装完**完全退出 DSH 再打开**（换安装路径必须完全重启，只刷新页面会看不到侧边栏图标）。

## 3. 用

左侧边栏底部，排在「插件」「定时任务」之后的画布图标。数据存在 `~/.dsh/conversation-flow/graph.json`。

## 升级

新 zip 解压到带版本号的新目录，让 Agent 先卸载旧的、再装新目录，然后完全重启 DSH。

## 卸载

让 Agent 卸载这个插件（包名 `@local/dsh-conversation-flow`）。不会删 `graph.json`，重装后画布还在。
