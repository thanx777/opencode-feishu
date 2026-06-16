---
name: feishu-debug
description: Diagnose and fix opencode-feishu plugin issues - Feishu not responding, session errors, message delivery failures
---

# Feishu Plugin Debug Playbook

Systematic diagnosis for opencode-feishu plugin issues. Follow layers L1→L5 in order.

## Symptom → Layer Mapping

| Symptom | Start at | Skip to |
|---------|----------|---------|
| Bot 不回消息 (no reply) | L2 | → L4 if queue stuck |
| 群聊绑定后不回复 | L1 | → L3 if model error |
| 会话丢失/无法获取 | L5 | → L2 if DB corrupt |
| 卡片不更新 | L2 | → L1 if CardKit down |
| 间歇性不回复 | L3 | → L4 if recovery fails |

## Layer Checks

### L1: Gateway & CardKit (飞书连接层)
```bash
# Check WebSocket connection
FEISHU_DEBUG=1 opencode 2>&1 | head -50

# Verify CardKit availability
grep -r "cardkit" src/feishu/ --include="*.ts" | head -5
```

**Look for**: `mirrorTextToMessage: true` in logs → CardKit unavailable, using text fallback

### L2: Session Queue (串行队列)
```bash
# Check for stuck sessions
grep -r "session-queue" src/handler/ --include="*.ts"
```

**Key**: Per-sessionKey FIFO queue prevents concurrent card overwrites. If stuck:
1. Check if previous message's `handleChat` never completed
2. Look for `drainLoop` hanging

### L3: Error Classification (5-kind system)
```bash
# Check error classification
grep -r "classify" src/handler/errors.ts
```

**Priority chain**: Auth → Context → Model → Poison → fallback

| Kind | Symptom | Fix |
|------|---------|-----|
| Unauthorized | 401/403 | Check `feishu.json` app credentials |
| ContextOverflow | Context too long | Check prompt size limits |
| ModelUnavailable | Model down/timeout | L3 recovery: try default model (max 2x) |
| SessionPoisoned | Corrupted session | Clear session, restart |
| UnknownUpstream | Other errors | Check OpenCode logs |

### L4: Event Dispatch (SSE事件分发)
```bash
# Check expectedMessageId lock
grep -r "expectedMessageId" src/handler/event.ts
```

**Key**: First SSE event locks messageID. Subsequent non-matching events silently dropped.

### L5: Database & Session Storage
```bash
# Check OpenCode data directory
ls -la ~/.local/share/opencode/

# Verify DB integrity
sqlite3 ~/.local/share/opencode/opencode.db ".tables"
```

## Quick Fix Sequence

1. **重启 OpenCode**: `taskkill /F /IM opencode.exe; opencode`
2. **检查端口**: `netstat -ano | findstr :4096`
3. **查看日志**: `FEISHU_DEBUG=1 opencode 2>debug.log`
4. **验证配置**: Check `~/.config/opencode/plugins/feishu.json`

## Common Root Causes

1. **CardKit 不可用** → 降级到纯文本，`mirrorTextToMessage` flag 触发
2. **Session queue 卡住** → 前一条消息未完成，后续消息排队
3. **模型不可用** → L3 自动恢复用默认模型（每 sessionKey 最多 2 次）
4. **Session 被污染** → classify 检测到 SessionPoisoned，需要清理
5. **端口未释放** → OpenCode 进程未完全退出，端口占用

## Files Reference

| File | Purpose |
|------|---------|
| `src/handler/chat.ts` | 核心对话处理 (1420 lines) |
| `src/handler/event.ts` | SSE 事件分发 (643 lines) |
| `src/handler/errors.ts` | 5-kind 错误分类 |
| `src/handler/error-recovery.ts` | 模型错误自动恢复 |
| `src/handler/session-queue.ts` | per-sessionKey FIFO 队列 |
| `src/feishu/gateway.ts` | WebSocket 网关 |
