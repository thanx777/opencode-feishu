# 飞书手机控制 OpenCode - 完整用户文档

> 📱 通过飞书 bot 在手机上控制电脑上的 OpenCode 编程助手
>
> 插件：`opencode-feishu` v1.10.10
> 代码位置：`<插件目录>/`（即本项目根目录）
> 工程文件位置：`<工程目录>/`（由 `workspaceRoots` 配置）

---

## 📁 目录结构

```
<根目录>\
├── opencode-feishu\                  ← 插件代码 + 基础设施 (代码, 不放工程文件)
│   ├── src\                          ← 插件源码
│   ├── dist\index.js                 ← 编译产物 (start-serve 时自动加载)
│   ├── package.json
│   ├── scripts\                      ← 基础设施脚本
│   │   ├── start-serve.bat           ← 启动 opencode serve
│   │   ├── stop-serve.bat            ← 停止 opencode serve
│   │   ├── kill-desktop.bat          ← 关闭 OpenCode 桌面端 (解决 WebSocket 冲突)
│   │   ├── add-firewall-rule.ps1     ← 防火墙 (需管理员, 通常不需要)
│   │   ├── add-autostart-task.ps1    ← 开机自启 (需管理员, 可选)
│   │   ├── check-conn.ps1            ← 诊断 opencode 出站连接
│   │   ├── test-*.ts                 ← 插件测试
│   │   └── logs\                     ← opencode 运行时日志
│   ├── FEISHU.md                     ← 本文档
│   ├── README.md                     ← 英文 npm 文档
│   └── feishu.local.json             ← 本地配置覆盖 (含明文 secret, 已 gitignore)
│
└── <工程目录>\                        ← 你的工程文件 (workspaceRoots 根目录)
    ├── backend\  frontend\  docs\    ← 示例子工程 (占位, 可删)
    ├── .gitignore
    └── README.md
```

---

## ⚠️ 前置条件 (必读)

### 1. 必须关闭 OpenCode 桌面端
- 桌面端有自己的 embedded serve，**它也会读 `opencode.jsonc` 并加载 `opencode-feishu` 插件**
- 桌面端和 CLI serve **同时运行** → 飞书 WebSocket 抢同一 bot → 飞书行为不确定（不回、回 1 条、回 2 条）
- 关闭方法：
  - 正常方式：桌面窗口点 X
  - 强制方式：跑 `scripts\kill-desktop.bat`

### 2. 不需要手机连 PC 的 4096 端口
- 飞书 bot 走 PC → 飞书云 → 手机的链路，**手机不直接连 PC**
- 校园网 AP isolation / WiFi 隔离 **不影响** 飞书 bot
- 4096 端口是给"opencode 桌面端/TUI/浏览器"直连用的，飞书 bot 不需要
- 所以**不需要加防火墙规则**（如果只想用飞书 bot）

### 3. 电脑需要联网到飞书云
- PC 出站到 `open.feishu.cn:443` (WebSocket)
- 几乎所有网络都允许

---

## 🔐 飞书应用权限（必须配置）

在 [飞书开放平台](https://open.feishu.cn/app) 创建**自建应用**后，需要开通以下权限：

### 1. 添加机器人能力
应用详情页 →「机器人」→ 开启

### 2. 事件订阅（**长连接**方式）
应用详情页 →「事件订阅」→ 订阅方式选 **「使用长连接接收事件/回调」**（不是 Webhook）

添加以下事件：
- `im.message.receive_v1` — 接收消息
- `im.chat.member.bot.added_v1` — bot 被加入群

### 3. 权限管理

| 权限 | 用途 | 必需 |
|------|------|:----:|
| `im:message` | 收发消息 | ✅ |
| `im:message:send_as_bot` | bot 发送消息 | ✅ |
| `im:message.p2p_msg:readonly` | 读取单聊消息 | ✅ |
| `im:message.group_at_msg:readonly` | 读取群聊中 @ bot 的消息 | 群聊需要 |
| `im:chat:readonly` | 读取群信息 | 群聊需要 |
| `cardkit:card` | CardKit 基础（消息卡片） | ✅ |
| `cardkit:card:write` | CardKit 写入（**流式卡片，必需**） | ✅ |
| `contact:user.base:readonly` | 解析用户姓名 | 可选 |

### 4. 发布应用
**权限变更后必须重新发布应用版本**才生效。流程：
- 应用详情 →「版本管理与发布」→ 创建版本 → 提交审核（自建应用一般自动通过）→ 发布

### 5. 怎么验证权限都齐了？
启动 serve 后看 `scripts\logs\serve.log`：
- 没有 `99991672 cardkit:card:write 缺失` → ✅
- 没有 `99991663 im:message 缺失` → ✅
- 看到 `WebSocket connected` → ✅

群聊专属问题：如果群里 @ bot 无效，看是不是手打了 `@bot名` —— **必须从选人菜单选 bot**，手打的 @ 飞书不识别。

### 群聊特别说明：`im:message.group_at_msg:readonly`

这个权限是**群聊专用**，容易漏配：

| 场景 | 没开通会怎样 | 开通后 |
|------|--------------|--------|
| 单聊（私聊 bot） | ✅ 不受影响，正常用 | ✅ 正常 |
| 群聊里 @ bot | ❌ bot 完全不响应 | ✅ bot 正常回复 |
| 群聊里不 @ bot | ✅ 静默积累上下文（设计如此） | ✅ 静默积累 |

**关键点**：
- **私聊不需要**这个权限，所以表格里标"群聊需要"而不是"必需"
- 但**任何要群聊的场景都必开**，否则开了群也等于没开
- 飞书后台搜索 `im:message.group_at_msg:readonly` 一次性加上即可

**群里 @ bot 的正确姿势**：
- ❌ 错：手打 `@我的bot`（飞书不识别）
- ✅ 对：输入 `@` → 弹出选人菜单 → 选你的 bot（飞书能识别）

---

## 🚀 启动流程

## 🚀 启动流程

### 步骤 1：启动 opencode serve

```cmd
scripts\start-serve.bat
```

成功输出：
```
[INFO] Started opencode.exe PID=xxx, waiting for port 4096...
[OK] opencode serve started PID=xxx port=4096
[OK] Log: scripts\logs\serve.log
[OK] Auth: Basic opencode/<password in bat>
Press Enter to close:
```

按 Enter 关掉 cmd 窗口，serve 继续在后台跑。

### 步骤 2：（可选）手机浏览器验证网络

```cmd
# 查电脑 IP
ipconfig
# 找 IPv4 地址, 例如 192.168.1.100
```

手机浏览器开 `http://<电脑IP>:4096/global/health`，输入 `opencode` / `<你的密码>`，应见 `{"healthy":true,"version":"x.x.x"}`。

> 校园网有 AP isolation 时这步会失败 — 但飞书 bot 仍能用。

### 步骤 3：（可选）开机自启

右键 `scripts\add-autostart-task.ps1` → 管理员 PowerShell 跑

创建"登录时启动"任务，下次开机自动跑 `start-serve.bat`。

### 步骤 4：（可选，几乎不需要）防火墙

右键 `scripts\add-firewall-rule.ps1` → 管理员 PowerShell 跑

仅在你要**用手机浏览器/TUI直连 4096** 时才需要。仅用飞书 bot 不需要。

---

## 💬 飞书命令速查表

### `/dir list`
**作用**：列出所有可管理的工程

**期望返回**：蓝色卡片
```
📂 可用工程 (4 个)
─────────────────
1. backend      <工程目录>\backend
2. docs         <工程目录>\docs
3. frontend     <工程目录>\frontend
4. (root)       <工程目录>
```

### `/dir <名字>`
**作用**：把当前聊天绑定到指定工程，之后所有消息都跑在这个目录里

**示例**：
```
/dir backend
```

**期望返回**：
- 绿色卡片：
  ```
  ✅ 已绑定 backend
  工程: <工程目录>\backend
  ```
- pinned 状态消息（聊天里多出的一条普通文本消息，bot 持续编辑它）：
  ```
  📌 backend 实时状态
  工程: <工程目录>\backend
  状态: ⏸ 等待中
  最后活动: 16:30:15
  ```

**注意**：
- 名字大小写不敏感
- 不存在会返回红色错误卡片
- 切工程时**旧 pinned 删，新 pinned 建**

### `/unbind`
**作用**：解除当前聊天的工程绑定，pinned 状态消息删除

### 普通对话消息
**作用**：让 AI 在当前绑定的工程里跑任务

**示例**（绑定 backend 后）：
```
帮我写一个 hello.py 输出 hello world
```

**pinned 消息会实时变化**：
```
状态: 🔄 运行中
💬 tool: bash
→ 状态: ✅ 已完成
💬 返回了 hello.py 内容
```

> 模型是 `opencode/deepseek-v4-flash-free`（免费，由插件强制设置）。
> 流式输出在飞书里是一张持续更新的卡片。

---

## 🎯 Pinned 状态消息说明

聊天里那条 `📌 xxx 实时状态` 消息是 bot 自己发的普通文本消息，**bot 持续编辑**它。

| 状态 | 含义 |
|------|------|
| ⏸ 等待中 | 当前没有任务在跑 |
| 🔄 运行中 | 正在执行 |
| ✅ 已完成 | 任务结束 |
| ❌ 错误 | 任务失败 |
| ⏸ 空闲 | session 关闭了 |

> **不要手动删除 pinned 消息** — 删了 bot 会重新建，但状态就断了。
> 想清理 → `/unbind`（pinned 自动删）。

---

## 🔔 后台通知说明

手机锁屏 / 切走时，PC 上有任务完成 → 飞书弹一条新消息（不是卡片，是文本）：
```
[backend] 任务完成 (ses_abc123)
tool: bash 返回了 hello.py
```

**节流规则**：
- 同一 chat 5 秒内只发一条（防刷屏）
- pinned 编辑 1 秒内不重复（防刷屏）

---

## 🔁 常用工作流

### 场景 1：手机单聊用
```
1. /dir list                  ← 查工程
2. /dir backend               ← 选工程
3. 写个 hello.py              ← 派任务
4. /unbind                    ← 结束
```

### 场景 2：多设备同步
- **手机私聊** 和 **群** 都 `/dir backend`
- 电脑跑任务时，**两个 chat 的 pinned 都同步更新**
- 手机锁屏 → 后台任务完成 → 飞书**弹通知**

### 场景 3：快速切换
```
/dir frontend    ← 切到前端
... 跑前端任务 ...
/dir docs        ← 切到文档
... 跑文档任务 ...
/unbind          ← 收工
```

### 群聊模式
- 私聊：直接发命令，不用 @
- 群聊：必须 `@你的bot名` 前缀

---

## 🔧 故障排查

### 1. Bot 完全不响应
1. 看 `scripts\logs\serve.log` 末尾 30 行
2. 找 `[feishu]` 开头的日志 → 看初始化 / 错误信息
3. 常见：
   - `配置验证失败` → `feishu.local.json` 或 `~/.config/opencode/plugins/feishu.json` 格式错
   - `WebSocket 连接失败` → 电脑没网（不是手机没网）
   - `cardkit:card:write 缺失` → 飞书应用权限没加，需要去开发者后台加

**快速诊断 opencode 进程在和谁通信**：
```powershell
scripts\check-conn.ps1
```
应看到至少一个 443 连接（飞书云 / AI provider）。

### 2. 401 / 认证错误
- 确认 `feishu.local.json` / `feishu.json` 里 `serverPassword` 和 `start-serve.bat` 第 16 行 `SERVER_PASSWORD` 一致
- 改了任一个都要重启 `opencode serve`（`stop-serve.bat` + `start-serve.bat`）

### 3. Pinned 消息不更新
- 看 pinned 是不是被自己删了（删了 bot 不会重建）
- 用 `/dir` 重新绑定一次

### 4. Bot 回复了两遍 / 完全不回
- 桌面端没关。两个 `opencode-feishu` 实例在抢 WebSocket
- 解决：跑 `scripts\kill-desktop.bat` 关掉桌面端

### 5. 模型用错 / 用了付费模型
- 看是不是用了别的客户端（如 `opencode TUI`）改过 model
- `feishu.json` 配的 `model: "opencode/deepseek-v4-flash-free"` 是全局默认值
- 插件**强制**用这个 model（看 `src/index.ts` 的 `getGlobalDefaultModel`）

### 6. start-serve.bat "闪退"
- 实际上是 cmd 窗口跑完立即关闭（**设计如此**），不是真的崩溃
- serve 进程是后台运行的，按 `start-serve.bat` 里的 `pause` 后能看到输出
- 验证：跑 `check-conn.ps1` 看有没有 opencode 进程在监听 4096

---

## 📂 关键配置位置

```
~\.config\opencode\
  opencode.jsonc          ← OpenCode 全局: plugin/model/server
  plugins\feishu.json     ← 飞书插件: appId/appSecret/workspaceRoots/serverPassword

<插件目录>\
  feishu.local.example.json    ← 配置模板 (commit 进 git)
  feishu.local.json            ← 本地覆盖 (明文 secret, gitignore)
  scripts\start-serve.bat      ← 启动 (SERVER_PASSWORD 在第 16 行)

<工程目录>\
  backend\ frontend\ docs\    ← 你的工程子文件夹
```

修改密码（同时改两处保持一致）：
1. `scripts\start-serve.bat` 第 16 行 `set SERVER_PASSWORD=xxx`
2. `feishu.local.json` 第 8 行 `"serverPassword": "xxx"`
3. 重启 serve：`stop-serve.bat` + `start-serve.bat`

---

## 🛑 收工流程

```cmd
scripts\stop-serve.bat
[OK] Killed opencode.exe on port 4096 PID=xxx
```

或直接关机。下次开机用 `start-serve.bat` 起来（可选装开机自启）。

---

## 🧪 我已自测的内容

- ✅ `npm run typecheck` 0 错误
- ✅ `npm run build` 成功 (~220 KB)
- ✅ PR1 测试 (12 个): scan + dir command + chat-project-map
- ✅ PR2 测试 (6 个): pinned + notification + 路由
- ✅ `opencode serve` 启动 + Basic Auth (`opencode/<your-password>` → /global/health 返回 200)
- ✅ `start-serve.bat` / `stop-serve.bat` / `kill-desktop.bat` 路径正确
- ⚠️ 飞书 bot 端到端未自测 (需要你在飞书里实际发消息)

---

## 📞 找帮助

- 日志：`scripts\logs\serve.log`
- 插件源码：`src\`
- 测试脚本：`scripts\test-*.ts` (用 `npx tsx scripts/test-*.ts` 跑)
- 出问题贴日志问 AI
