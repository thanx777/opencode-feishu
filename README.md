# opencode-feishu

[![npm](https://img.shields.io/npm/v/opencode-feishu)](https://www.npmjs.com/package/opencode-feishu)

[OpenCode](https://opencode.ai) 飞书插件 — 通过飞书 WebSocket 长连接将飞书消息接入 OpenCode AI 对话。

> 📖 **中文用户文档**：[FEISHU.md](./FEISHU.md) — 安装/启动/飞书命令/故障排查

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
3. **回调配置** — 添加 `card.action.trigger`（卡片按钮交互回调，必需）
4. **订阅方式** — 事件和回调均选择「使用长连接接收事件/回调」（不是 Webhook）
5. **权限管理** — 开通以下权限：
6. **发布应用**（权限和回调变更需重新发布）

| 权限 | 用途 |
|------|------|
| `im:message` | 收发消息 |
| `im:message:send_as_bot` | bot 发送消息 |
| `im:message.p2p_msg:readonly` | 读取单聊消息 |
| `im:message.group_at_msg:readonly` | 读取群聊中 @ bot 的消息 |
| `im:chat:readonly` | 读取群信息 |
| `cardkit:card` | CardKit 基础权限（消息卡片） |
| `cardkit:card:write` | CardKit 写入权限（流式卡片，必需） |
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

### 配置注意事项

**`workspaceRoots` 只在插件配置中有效**

`workspaceRoots` 是插件自定义字段，**不能**写在 `~/.config/opencode/opencode.jsonc` 中（会导致 `ConfigInvalidError`）。只能放在 `feishu.local.json` 或 `feishu.json` 里。

```json
// ✅ 正确：feishu.local.json
{
  "workspaceRoots": ["D:\\projects", "D:\\work"]
}

// ❌ 错误：opencode.jsonc
{
  "workspaceRoots": [...]   // OpenCode 不认识这个字段
}
```

**桌面端 vs CLI serve 不能同时运行**

两者都会连接飞书 WebSocket，同一 bot 出现两个连接会导致消息行为不确定（不回、回一条、回两条）。切换前必须先停掉另一个。

**Basic Auth 必须一致**

`serverUsername` / `serverPassword` 必须与启动 serve 时的环境变量相同：

```bash
# start-serve.bat 里设的值必须等于 feishu.local.json 里的值
OPENCODE_SERVER_PASSWORD=xxx opencode serve ...
```

**群聊需要单独开通权限**

群聊中 bot 默认不回复。需要：
1. 飞书后台开通 `im:message.group_at_msg:readonly`
2. 群里输入 `@` 从选人菜单选 bot，**不能手打 @名字**

**环境变量支持**

所有字符串字段都支持 `${ENV_VAR}` 语法，启动时自动展开：

```json
{
  "appId": "${FEISHU_APP_ID}",
  "appSecret": "${FEISHU_APP_SECRET}",
  "directory": "${OPENCODE_WORKSPACE}"
}
```

**Windows 插件路径**

Windows 上 Bun 安装有 EPERM 问题，`opencode.jsonc` 中建议用绝对路径：

```json
{
  "plugin": ["D:/path/to/opencode-feishu"]
}
```

## 特性

- **稳定性增强** — 插件加载失败时自动降级为无操作模式，避免 OpenCode Agent 崩溃（v1.10.11+）
- **会话稳定性** — 降级模式下正确返回空工具列表，修复特定会话报错 503 的问题（v1.10.12+）
- **CardKit 2.0 流式卡片** — AI 回复实时显示文本（markdown 渲染）和工具调用进度
- **交互式卡片** — 权限审批和问答通过按钮完成（card.action.trigger 回调）
- **多工程绑定** — `/dir` 命令在群聊/单聊绑定不同工程，换绑自动转移上下文；文件夹浏览器模式支持逐级浏览、返回上级、确定绑定
- **模式切换** — `/mode` 命令切换 plan（规划）/ build（执行）模式，per-sessionKey 覆盖
- **模型切换** — `/model` 命令查看可用模型并切换，per-sessionKey 覆盖
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
| `/mode` | 切换 AI 模式（plan 规划 / build 执行），显示按钮选择 |
| `/mode plan` | 直接切换到 plan 模式 |
| `/mode build` | 直接切换到 build 模式 |
| `/model` | 查看当前模型 + 可用模型列表（按钮选择） |
| `/model <id>` | 切换到指定模型（id 格式：providerID/modelID） |
| `/dir` | 查看当前聊天绑定的工程 |
| `/dir list` | 打开文件夹浏览器，按按钮选择工作区 |
| `/dir browse <path>` | 浏览指定路径的子目录 |
| `/dir bind <path>` | 按路径直接绑定工程 |
| `/dir <name>` | 将此聊天绑定到 `<name>` 工程 |
| `/unbind` | 解除工程绑定，回退到默认目录 |
| `/history` | 查看当前会话的历史记录 |

### 工程绑定

群聊/单聊可独立绑定不同工程。换绑时自动提取旧 session 的最后 15 条对话文本，注入到新 session 作为上下文摘要，避免切换工程后丢失讨论记忆。

**路径来源：**

```
feishu.local.json
├── workspaceRoots  →  /dir list 扫描这些目录下的子文件夹
└── directory       →  未绑定时 AI 工作的默认目录
```

例如：

```json
{
  "directory": "D:\\work\\main",
  "workspaceRoots": ["D:\\work", "E:\\projects"]
}
```

- `/dir list` → 打开文件夹浏览器，显示 `workspaceRoots` 中的根目录按钮；点击进入浏览子目录，底部"确定"按钮绑定当前目录
- 没绑定时 → AI 在 `D:\work\main` 工作
- `/dir my-app` → 绑定后切到具体子目录（也可在欢迎卡片或 `/dir list` 卡片中点击按钮选择）

- 绑定存储在内存中，24 小时无活动自动过期
- 重启 serve 后绑定丢失，重新 `/dir` 即可
- 多群可绑定同一工程，互不干扰

### 群聊行为

群聊中 bot 仅在被 **@提及**（从选人菜单选 bot，不是手打 @名字）时回复。未 @ 的消息仍会转发给 OpenCode 作为静默上下文。

## 脚本工具

`scripts/` 目录下提供了几个辅助脚本：

### 启动/停止

| 脚本 | 说明 |
|------|------|
| `start-serve.bat` | 通用启动脚本，需设置环境变量 `OPENCODE_WORKSPACE` 和 `OPENCODE_SERVER_PASSWORD` |
| `start-serve-debug.bat` | 调试模式启动，启用 `FEISHU_DEBUG=1` 并输出日志到 `scripts/logs/debug.log` |
| `stop-serve.bat` | 停止 serve 进程 |

> 本地使用时建议直接用 `add-autostart-task.ps1` 生成带配置的启动脚本（见下方）。

### 开机自启

```powershell
# 以管理员身份运行 PowerShell
.\add-autostart-task.ps1 -Workspace "D:\your\project" -Password "your-password"
```

会生成 `start-autostart.bat`（含你的配置，已 gitignore）并创建 Windows 计划任务，登录时自动启动。

## 常见问题

### Q: 飞书机器人不回复？

1. 单聊：确认 serve 启动后创建了 session（`start-serve.bat` 会自动做）
2. 群聊：需开通 `im:message.group_at_msg:readonly` 权限，并且**从选人菜单 @ bot**（手打 `@名字` 不起作用）
3. 桌面端和 CLI serve 不能同时运行——双 WebSocket 会导致行为不确定

### Q: Web UI 的 "Open Folder" 选不了 D 盘？

已知 bug（[GitHub #6490](https://github.com/anomalyco/opencode/issues/6490)）。在路径栏**用正斜线 `/`** 输入，然后按 **Tab**：

```
D:/your/path
```

### Q: Web UI 项目列表不显示新路径？

创建一个 session 即可注册：

```bash
curl -u "opencode:password" -X POST "http://localhost:4096/session?directory=D%3A%2Fyour%2Fpath" -H "Content-Type: application/json" -d "{}"
```


### Q: `ConfigInvalidError: Unrecognized key: workspaceRoots`？

`workspaceRoots` 只能写在 `feishu.local.json`（插件配置），**不能**写在 `opencode.jsonc`（OpenCode 主配置）。详见[配置注意事项](#配置注意事项)。

### Q: 桌面端启动后"会话获取失败"、模型选不了？

通常是 `opencode.jsonc` 中包含了 OpenCode 不认识的字段（如 `env`、`workspaceRoots` 等），导致配置校验失败（`ConfigInvalidError`），整个应用无法初始化。

排查步骤：

1. 检查 `~/.config/opencode/opencode.jsonc`，确认没有 `env`、`workspaceRoots` 等非 OpenCode schema 定义的字段
2. OpenCode 配置 schema 不支持顶层 `env` 字段——如需设置 Provider API Key，应使用 `provider.<id>.options.apiKey`
3. 临时禁用插件排查：将 `"plugin": [...]` 改为 `"plugin": []`，确认是否为插件引起
4. 查看日志：`~/.local/share/opencode/log/` 下按时间戳命名的日志文件

### Q: serve 模式启动后插件没加载？

`opencode serve` 启动时不创建实例，插件不会自动加载。`start-serve.bat` 已包含自动创建 session 的逻辑。手动启动需执行：

```bash
curl -u "opencode:password" -X POST "http://localhost:4096/session?directory=<workspace-encoded>" -H "Content-Type: application/json" -d "{}"
```

### Q: 重启 serve 后 `/dir` 绑定丢失？

绑定存储在内存中，重启即清空。重新 `/dir <name>` 即可。24 小时无活动也会自动过期。

### Q: 桌面端/Web UI 报 503 Service Unavailable？

```
无法重新加载 xxx
opencode server GET http://127.0.0.1:5484/agent?directory=... → 503 Service Unavailable
```

**原因**：OpenCode 配置中引用了一个不存在的工作区目录。当客户端尝试加载该工作区时，server 无法初始化 agent，返回 503。

**解决方法**：在 OpenCode 客户端中删除该工作区引用（在项目列表中移除不存在的目录）。如果无法操作客户端，检查 `~/.config/opencode/` 下的配置文件，确认所有引用的目录路径都存在。

### Q: `/model` 切换模型后 AI 仍说自己是 deepseek？

`opencode` provider 的免费模型（如 `minimax-m3-free`、`deepseek-v4-flash-free`）底层可能共享同一个 API 端点，实际调用的可能是 deepseek 的模型。这是 OpenCode 的 provider 路由行为，不是插件的 bug。`/model` 切换确实生效了（可通过 `FEISHU_DEBUG=1` 日志确认 `providerID` 和 `modelID` 已变更），但 AI 自身无法感知被路由到了哪个底层模型。如需使用不同底层模型，可切换到 `nvidia` 或 `github-copilot` 等其他 provider。

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

### 环境变量

| 变量 | 说明 |
|------|------|
| `FEISHU_DEBUG` | 设为 `1` 时启用结构化 JSON 日志输出到 stderr |
| `logLevel`（配置项） | 控制 Lark SDK 内部日志级别：`fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` | 代理设置，WebSocket 连接和 API 请求均走代理 |
| `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` | Langfuse 追踪（可选，两者都设置时启用） |
| `LANGFUSE_BASEURL` | Langfuse 自部署地址（默认 `https://cloud.langfuse.com`） |

### 调试命令

**Linux / macOS：**

```bash
# 启用调试日志（结构化 JSON 输出到 stderr）
FEISHU_DEBUG=1 opencode

# 过滤错误日志
FEISHU_DEBUG=1 opencode 2>&1 | grep '"level":"error"'

# 重定向到文件
FEISHU_DEBUG=1 opencode 2>feishu-debug.log
```

**Windows PowerShell：**

```powershell
# 启用调试日志
$env:FEISHU_DEBUG="1"; opencode

# 过滤错误日志
$env:FEISHU_DEBUG="1"; opencode 2>&1 | Select-String '"level":"error"'

# 重定向到文件
$env:FEISHU_DEBUG="1"; opencode 2>feishu-debug.log
```

> **说明：** `FEISHU_DEBUG=1` 仅在 stderr 输出结构化 JSON，不影响 stdout 管道。日志级别可通过 `feishu.json` 中的 `logLevel` 字段单独控制。

## 许可证

MIT
