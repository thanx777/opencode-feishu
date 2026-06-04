# 飞书手机控制 OpenCode - 操作手册

> 📱 通过飞书 bot 在手机上控制电脑上的 OpenCode 编程助手
> 
> 插件：`opencode-feishu` v1.10.10
> 路径：`D:\Vibecoding\Opencode_WithPhone\`

---

## 🚦 启动前检查（每次用前确认）

| 检查项 | 命令 | 期望结果 |
|--------|------|----------|
| ✅ OpenCode 桌面端已关 | 看任务管理器 | 没有 `OpenCode.exe` 进程 |
| ✅ `opencode serve` 在跑 | `D:\Vibecoding\Opencode_WithPhone\scripts\start-serve.bat` | 看到 `[OK] opencode serve started PID=xxx port=4096` |
| ✅ 飞书插件已加载 | 看 `scripts\logs\serve.log` | 没有 "opencode-feishu 初始化失败" |
| ✅ Bot 已添加 | 飞书 → 通讯录 → 机器人 | 你的 bot 在列表里 |

如果 serve 端口被占 → `stop-serve.bat` 后重试。

---

## 💬 飞书里怎么用

### 找到 bot

- **私聊**：飞书 App → 顶部搜索 → 搜 bot 名字 → 进入对话
- **群聊**：拉 bot 进群 → 消息必须 `@你的bot名` 前缀

---

## 📖 命令速查表

### `/dir list`
**作用**：列出所有可管理的工程

**期望返回**：蓝色卡片
```
📂 可用工程 (4 个)
─────────────────
1. backend      D:\Vibecoding\Opencode_Project\backend
2. docs         D:\Vibecoding\Opencode_Project\docs
3. frontend     D:\Vibecoding\Opencode_Project\frontend
4. (root)       D:\Vibecoding\Opencode_Project
```

---

### `/dir <名字>`
**作用**：把当前聊天**绑定**到指定工程，之后所有消息都跑在这个目录里

**示例**：
```
/dir backend
```

**期望返回**：绿色卡片 + pinned 状态消息
```
✅ 已绑定 backend
工程: D:\Vibecoding\Opencode_Project\backend
```

聊天里多出一条 pinned 文本消息（不删，留着持续更新）：
```
📌 backend 实时状态
工程: D:\Vibecoding\Opencode_Project\backend
状态: ⏸ 等待中
最后活动: 16:30:15
```

**注意**：
- 名字大小写不敏感（`Backend` / `backend` 等价）
- 不存在会返回红色错误卡片
- 切工程时**旧 pinned 删，新 pinned 建**

---

### `/unbind`
**作用**：解除当前聊天的工程绑定，pinned 状态消息删除

**期望返回**：绿色卡片
```
✅ 已解除绑定
解除: D:\Vibecoding\Opencode_Project\backend
回退: D:\Vibecoding\Opencode_Project
```

---

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
> 流式输出在飞书里是一张持续更新的卡片，不是终端。

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
- 电脑（在你手边）跑任务
- 两个 chat 的 pinned **同步更新**
- 手机锁屏 → 后台任务完成 → 飞书**弹通知**（不是 pinned，是新消息）

### 场景 3：快速切换
```
/dir frontend    ← 切到前端
... 跑前端任务 ...
/dir docs        ← 切到文档
... 跑文档任务 ...
/unbind          ← 收工
```

---

## 🎯 Pinned 状态消息说明

聊天里那条 `📌 xxx 实时状态` 消息是普通文本（不是飞书真 pinned 消息，是 bot 发的普通消息），bot 自己会持续**编辑**它。

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

你手机锁屏 / 切走时，PC 上有任务完成：

- 飞书会**弹一条新消息**（不是卡片，是文本）
- 内容形如：
  ```
  [backend] 任务完成 (ses_abc123)
  tool: bash 返回了 hello.py
  ```
- 5 秒内只发一条（防刷屏）
- 1 秒内不重复编辑 pinned（防刷屏）

---

## 🔧 故障排查

### Bot 完全不响应

1. 看 `D:\Vibecoding\Opencode_WithPhone\scripts\logs\serve.log` 末尾 30 行
2. 找 `[feishu]` 开头的日志 → 看初始化 / 错误信息
3. 常见：
   - `配置验证失败` → `C:\Users\thanx\.config\opencode\plugins\feishu.json` 格式错
   - `WebSocket 连接失败` → 电脑没网（不是手机没网）
   - `cardkit:card:write 缺失` → 飞书应用权限没加，需要去开发者后台加

### 401 / 认证错误

- 确认 `feishu.json` 里 `serverPassword` 和 `start-serve.bat` 里 `SERVER_PASSWORD` 一致
- 改了任一个都要重启 `opencode serve`

### Pinned 消息不更新

- 看 pinned 是不是被自己删了（删了 bot 不会重建）
- 用 `/dir` 重新绑定一次

### Bot 回复了两遍

- 桌面端没关。两个 `opencode-feishu` 实例在抢 WebSocket
- 解决：完全退出桌面端，只留 `opencode serve`

### 模型用错 / 用了付费模型

- 看是不是用了别的客户端（如 `opencode TUI`）改过 model
- `feishu.json` 配的 `model: "opencode/deepseek-v4-flash-free"` 是全局默认值
- 插件**强制**用这个 model（看 `src/index.ts` 的 `getGlobalDefaultModel`）

---

## 📂 工程目录约定

| 路径 | 作用 |
|------|------|
| `D:\Vibecoding\Opencode_WithPhone\` | **插件代码**（你改代码在这里） |
| `D:\Vibecoding\Opencode_Project\` | **工程根**（你的项目文件夹放这里） |
| `D:\Vibecoding\Opencode_Project\backend\` | 示例子工程（占位，可删） |
| `D:\Vibecoding\Opencode_Project\frontend\` | 示例子工程（占位，可删） |
| `D:\Vibecoding\Opencode_Project\docs\` | 示例子工程（占位，可删） |

> 想加新工程 → 在 `Opencode_Project` 下建文件夹 → `/dir list` 自动识别
> 
> 改 `feishu.json` 的 `workspaceRoots` 可以改变扫描根。

---

## 🛑 收工流程

```
1. /unbind                    ← 解绑当前 chat
2. D:\Vibecoding\Opencode_WithPhone\scripts\stop-serve.bat
   [OK] Killed opencode.exe on port 4096 PID=xxx
```

或者直接关机，下次开机再 `start-serve.bat`（可选装开机自启计划任务）。

---

## 📞 找帮助

- 插件源码：`D:\Vibecoding\Opencode_WithPhone\src\`
- 测试脚本：`D:\Vibecoding\Opencode_WithPhone\scripts\test-*.ts`
- 日志：`D:\Vibecoding\Opencode_WithPhone\scripts\logs\serve.log`
- 配置文件：
  - `C:\Users\thanx\.config\opencode\opencode.jsonc` (OpenCode 全局)
  - `C:\Users\thanx\.config\opencode\plugins\feishu.json` (飞书插件)
- 出问题贴日志问我
