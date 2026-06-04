# opencode-feishu

[![npm](https://img.shields.io/npm/v/opencode-feishu)](https://www.npmjs.com/package/opencode-feishu)

[OpenCode](https://opencode.ai) 飞书插件 — 通过飞书 WebSocket 长连接将飞书消息接入 OpenCode AI 对话。

## 快速开始

### 1. 配置 OpenCode 加载插件

在 `~/.config/opencode/opencode.jsonc` 中添加：

```json
{
  "plugin": ["opencode-feishu"]
}
```

> Windows 上 Bun 安装存在 EPERM 权限问题，建议使用项目绝对路径：`"plugin": ["D:/path/to/opencode-feishu"]`

### 2. 创建飞书配置文件

**方式 A（推荐）**：在插件项目根目录创建 `feishu.local.json`，复制 `feishu.local.example.json` 并填入真实值：

```json
{
  "appId": "cli_xxxxxxxxxxxx",
  "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "directory": "D:\\your\\workspace",
  "workspaceRoots": ["D:\\your\\workspace"],
  "serverUsername": "opencode",
  "serverPassword": "your-password"
}
```

**方式 B**：创建 `~/.config/opencode/plugins/feishu.json`，格式同上。

> 优先级：`feishu.local.json` > `~/.config/opencode/plugins/feishu.json`
>
> 支持环境变量：`"appId": "${FEISHU_APP_ID}"` 会从 `process.env` 读取。

### 3. 配置飞书应用权限

在 [飞书开放平台](https://open.feishu.cn/app) 创建自建应用：

1. **添加机器人能力**
2. **事件订阅** — 添加 `im.message.receive_v1` 和 `im.chat.member.bot.added_v1`
3. **订阅方式** — 选择「使用长连接接收事件/回调」（不是 Webhook）
4. **权限管理** — 开通以下权限：

| 权限 | 用途 |
|------|------|
| `im:message` | 收发消息 |
| `im:message:send_as_bot` | bot 发送消息 |
| `im:message.p2p_msg:readonly` | 读取单聊消息 |
| `im:message.group_at_msg:readonly` | 读取群聊中 @ bot 的消息 |
| `im:chat:readonly` | 读取群信息 |
| `contact:user.base:readonly` | 解析用户姓名（可选） |

5. **发布应用**（权限变更需重新发布）

### 4. 启动

**桌面端**（推荐日常使用）：

直接打开 OpenCode 桌面应用。插件自动加载，飞书 WebSocket 自动连接。

> 需确保 `~/.config/opencode/opencode.jsonc` 中已声明插件路径（见步骤 1）。

**CLI 无头模式**（适合后台运行/服务器）：

```bash
# 设置 Basic Auth 环境变量（与 feishu.local.json 中的一致）
OPENCODE_SERVER_PASSWORD=your-password opencode serve --port 4096 --hostname 0.0.0.0
```

> 也可以用项目自带的 `scripts/start-serve.bat`（Windows）一键启动。

**⚠️ 桌面端和 CLI serve 二选一**，不能同时运行——两个进程都会连接飞书 WebSocket，同一 bot 出现两条连接会导致行为不确定。

| 模式 | 适用场景 | 自动连接飞书 |
|------|------|:---:|
| 桌面端 | 日常使用，有 UI 界面 | ✅ |
| CLI serve | 后台运行，无 UI | ✅ |
| CLI web | 浏览器访问 `http://localhost:4096` | ✅ |

## 配置说明

`feishu.local.json` 或 `~/.config/opencode/plugins/feishu.json` 完整配置：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|:----:|--------|------|
| `appId` | string | 是 | — | 飞书应用 App ID |
| `appSecret` | string | 是 | — | 飞书应用 App Secret |
| `directory` | string | 否 | OpenCode 工作目录 | 默认工作目录，未绑定工程时使用 |
| `workspaceRoots` | string[] | 否 | `[directory]` | 工程扫描根目录，`/dir list` 列出其直接子目录 |
| `serverUsername` | string | 否 | — | OpenCode serve 的 HTTP Basic Auth 用户名 |
| `serverPassword` | string | 否 | — | OpenCode serve 的 HTTP Basic Auth 密码 |
| `timeout` | number | 否 | — | 对话轮询总超时（毫秒） |
| `logLevel` | string | 否 | `"info"` | 日志级别：fatal/error/warn/info/debug/trace |
| `maxHistoryMessages` | number | 否 | `200` | 入群时最多摄入的历史消息条数 |
| `pollInterval` | number | 否 | `1000` | 轮询 AI 响应的间隔（毫秒） |
| `stablePolls` | number | 否 | `3` | 连续几次轮询内容不变视为回复完成 |
| `dedupTtl` | number | 否 | `600000` | 消息去重缓存过期时间（毫秒） |
| `maxResourceSize` | number | 否 | `524288000` | 单个资源最大下载大小（字节，默认 500MB） |
| `nudge.enabled` | boolean | 否 | `false` | 启用 session.idle 催促 |
| `nudge.intervalSeconds` | number | 否 | `30` | 催促最小间隔（秒） |
| `nudge.maxIterations` | number | 否 | `3` | 最大催促次数 |
| `nudge.message` | string | 否 | — | 催促 prompt 内容 |

## 特性

- **CardKit 2.0 流式卡片** — AI 回复实时显示文本（markdown 渲染）和工具调用进度
- **交互式卡片** — 权限审批和问答通过按钮完成（card.action.trigger 回调）
- **多工程绑定** — `/dir` 命令在群聊/单聊绑定不同工程，换绑自动转移上下文
- **Agent 卡片工具** — `feishu_send_card` tool，AI 自主决定何时使用卡片展示结构化内容
- **运行时 prompt 分层** — `prompt.md` 仅注入飞书渠道事实和工具契约
- **多媒体消息支持** — 图片、文件、音频、富文本（含内嵌图片）、卡片表格等
- **用户名显示** — 群聊消息自动解析飞书用户名替代 open_id（24h 缓存）
- **消息引用解析** — 解析飞书回复/引用关系，作为上下文传给 AI
- **群聊静默监听** — 所有群消息作为上下文积累，仅 @提及时回复
- **FIFO 消息队列** — P2P 和群聊统一串行队列，消息按顺序处理
- **入群自动摄入历史消息**
- **本地优先配置** — `feishu.local.json` 优先级高于全局配置，方便本地开发
- **session.idle 催促** — 工具调用后自动继续执行（可配置）
- **Langfuse 用户关联** — 每条消息关联 sessionId 和飞书 userId
- **代理支持** — `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`
- **消息去重** — 可配置 TTL（默认 10 分钟）
- **Zod 配置验证** — 启动时结构化验证配置，拼写/类型错误立即报出

## 产品行为

完整的产品行为契约（消息流程、责任分界、错误体验、不变量、配置如何影响行为）见 **[BEHAVIOR.md](./BEHAVIOR.md)**。

简表速查：

| 场景 | 发送到 OpenCode | AI 回复 | 飞书回复 |
|------|:---:|:---:|:---:|
| 单聊 | 是 | 是 | 是（流式卡片） |
| 群聊 + @bot | 是 | 是 | 是（流式卡片） |
| 群聊未 @bot | 是 | 否（静默积累上下文） | 否 |
| bot 入群 | 历史消息 | 否 | 否 |

支持的消息类型：text / image / 富文本 (post) / file / audio / 卡片 / quote。详见 BEHAVIOR.md §4.2。

### 会话命令

| 命令 | 功能 |
|------|------|
| `/new` | 重置当前会话，创建新 session |
| `/dir` | 查看当前聊天绑定的工程 |
| `/dir list` | 列出所有可绑定工程（`workspaceRoots` 下的子目录） |
| `/dir <name>` | 将此聊天绑定到 `<name>` 工程 |
| `/unbind` | 解除工程绑定，回退到默认目录 |
| `/history` | 查看当前会话的历史记录 |

### 工程绑定

群聊/单聊可独立绑定不同工程。换绑时自动提取旧 session 的最后 15 条对话文本，注入到新 session 作为上下文摘要，避免切换工程后丢失讨论记忆。

- 绑定存储在内存中，24 小时无活动自动过期
- 重启 serve 后绑定丢失，重新 `/dir` 即可
- 多群可绑定同一工程，互不干扰

### 群聊行为

群聊中 bot 仅在被 **@提及**（从选人菜单选 bot，不是手打 @名字）时回复。未 @ 的消息仍会转发给 OpenCode 作为静默上下文。

## 开发

```bash
npm install           # 安装依赖
npm run build         # 构建
npm run dev           # 开发模式（监听变更）
npm run typecheck     # 类型检查
npm run release       # 交互式版本发布（bumpp：选版本 → commit → tag → push）
npm publish           # 发布到 npm（自动先构建+类型检查）
npm publish --dry-run # 预览将要发布的内容
```

## 调试

```bash
# 启用调试日志（结构化 JSON 输出到 stderr）
FEISHU_DEBUG=1 opencode

# 过滤错误日志
FEISHU_DEBUG=1 opencode 2>&1 | grep '"level":"error"'

# 重定向到文件
FEISHU_DEBUG=1 opencode 2>feishu-debug.log
```

## 许可证

MIT
