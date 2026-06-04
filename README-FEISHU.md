# 📱 Opencode + 飞书手机控制 - 完整启动手册

## 📁 目录结构

```
D:\Vibecoding\
├── Opencode_WithPhone\              ← 插件 + 基础设施 (代码, 不放工程文件)
│   ├── src\                          ← 插件源码
│   ├── dist\index.js                 ← 编译产物 (start-serve 时自动加载)
│   ├── package.json
│   ├── scripts\                      ← 基础设施脚本
│   │   ├── start-serve.bat           ← 启动 opencode serve
│   │   ├── stop-serve.bat            ← 停止 opencode serve
│   │   ├── add-firewall-rule.ps1     ← 防火墙 (需管理员)
│   │   ├── add-autostart-task.ps1    ← 开机自启 (需管理员, 可选)
│   │   ├── test-*.ts                 ← 插件测试
│   │   └── logs\                     ← opencode 运行时日志
│   └── README-FEISHU.md              ← 本文件
│
└── Opencode_Project\                 ← 你的工程文件 (workspaceRoots 根目录)
    ├── backend\  frontend\  docs\    ← 示例子工程 (可以删除)
    ├── .gitignore
    └── README.md
```

## ✅ 当前状态

| 组件 | 状态 | 位置 |
|------|------|------|
| `opencode.exe` (CLI) | ✅ 已安装 v1.15.13 | `C:\Users\thanx\AppData\Local\Programs\opencode\opencode.exe` |
| `opencode-feishu` 插件 | ✅ 已编译 | `D:\Vibecoding\Opencode_WithPhone\dist\index.js` (220 KB) |
| Basic Auth | ✅ 已启用 | 用户名 `opencode` 密码 `12180103xz` |
| `feishu.json` 配置 | ✅ 完整 | AppID, Secret, workspaceRoots, serverPassword |
| `opencode.jsonc` | ✅ 干净 | 只含 plugin/model/server |
| start-serve.bat / stop-serve.bat | ✅ 写好 | `D:\Vibecoding\Opencode_WithPhone\scripts\` |
| add-firewall-rule.ps1 | ⚠️ **需手动管理员运行** | `D:\Vibecoding\Opencode_WithPhone\scripts\` |
| add-autostart-task.ps1 | ⚠️ **可选, 需手动管理员运行** | `D:\Vibecoding\Opencode_WithPhone\scripts\` |

---

## 🚀 启动流程(按顺序)

### 1. 启动 opencode serve

```cmd
D:\Vibecoding\Opencode_WithPhone\scripts\start-serve.bat
```

应看到:
```
[OK] opencode serve started PID=xxx port=4096
[OK] Log: ...\scripts\logs\serve.log
[OK] Auth: Basic opencode/<password in bat>
```

要停止: `D:\Vibecoding\Opencode_WithPhone\scripts\stop-serve.bat`

### 2. 添加防火墙(必须, 否则手机连不上)

右键 `D:\Vibecoding\Opencode_WithPhone\scripts\add-firewall-rule.ps1` → "使用 PowerShell 运行" → 选"以管理员身份运行"

完成后会自动显示:
```
[OK] 防火墙规则已添加
DisplayName : opencode serve 4096
Direction   : Inbound
Action      : Allow
Enabled     : True
Profile     : {Private, Domain}
```

如果你的电脑在**公共网络** profile 下(咖啡厅之类),需要把 `-Profile Private,Domain` 改成 `-Profile Any` 再重跑。

### 3. 手机测连通性(验证网络)

确认手机和电脑**在同一 WiFi**:

1. 查电脑 IP: 打开 cmd → `ipconfig` → 看 "IPv4 地址",例如 `192.168.1.100`
2. 手机浏览器访问 `http://192.168.1.100:4096/global/health`
3. 应该弹出 Basic Auth 弹窗,输入 `opencode` / `12180103xz`
4. 应该看到 `{"healthy":true,"version":"1.15.1"}`

如果第 3 步打不开 → 校园网有 AP isolation,需要找网管,或者用 USB 数据线共享网络。

### 4. 在飞书测试 bot

打开飞书,找到 bot,试试:
- `/dir list` → 列出 4 个工程 (backend, frontend, docs, (root))
- `/dir backend` → 绑定 backend,聊天里应该出现一条"📌 backend 实时状态"消息
- 发任意对话消息 → bot 会用 deepseek-v4-flash-free 在 backend 工程里跑
- 跑的时候观察 pinned 消息会不会实时更新
- `/unbind` → pinned 消息消失
- 在另一个群绑定 frontend,验证多 chat 隔离

### 5. (可选)开机自启

右键 `D:\Vibecoding\Opencode_WithPhone\scripts\add-autostart-task.ps1` → 管理员 PowerShell 跑

会创建一个"登录时启动"的任务,下次开机自动跑 `start-serve.bat`。

---

## 🔧 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 手机浏览器打不开 4096 | 校园网 AP isolation | 找网管 / 用 USB 网络共享 |
| 飞书 bot 无响应 | 插件 WebSocket 没连上 | 看 `D:\Vibecoding\Opencode_WithPhone\scripts\logs\serve.log` |
| 401 Unauthorized | 密码输错 | 确认 feishu.json 和 start-serve.bat 密码一致 |
| `start-serve.bat` 提示端口被占 | 之前的 serve 还在 | `stop-serve.bat` 后重试 |
| 插件报 "opencode client auth failed" | password 配置不对 | 检查 feishu.json 的 serverPassword |

---

## 📂 关键文件位置

```
C:\Users\thanx\.config\opencode\
  opencode.jsonc          ← 只含 plugin/model/server
  plugins\feishu.json     ← 含 appId/appSecret/workspaceRoots/serverPassword

D:\Vibecoding\Opencode_WithPhone\
  src\                    ← 插件源码 (TypeScript)
  dist\index.js           ← 编译产物 (start-serve 时自动加载)
  scripts\
    start-serve.bat       ← 启动 serve (后台)
    stop-serve.bat        ← 停止 serve
    add-firewall-rule.ps1 ← 需管理员
    add-autostart-task.ps1 ← 可选, 需管理员
    test-*.ts             ← 插件测试
    logs\serve.log        ← opencode 内部日志
    logs\serve.pid        ← 当前 serve PID

D:\Vibecoding\Opencode_Project\
  backend\ frontend\ docs\  ← 你的工程子文件夹
```

---

## 🧪 我已自测的内容

- ✅ `npm run typecheck` 0 错误
- ✅ `npm run build` 成功 (220 KB)
- ✅ PR1 测试 (12 个): scan + dir command + chat-project-map
- ✅ PR2 测试 (6 个): pinned + notification + 路由
- ✅ `opencode serve` 启动 + Basic Auth (`opencode:12180103xz` → /global/health 返回 200)
- ✅ `start-serve.bat` 启动 serve (PID 跟踪 OK)
- ✅ `stop-serve.bat` 只杀 opencode.exe, 不碰 OpenCode.exe
- ⚠️ 飞书 bot 端到端未自测 (需要你在飞书里实际发消息)
