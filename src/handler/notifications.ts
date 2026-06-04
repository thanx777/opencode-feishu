/**
 * Background session notifications（借鉴 grinev 模式）。
 *
 * 场景：飞书 chat 绑定了工程 X，但 chat 当前没有 active streaming card。
 * opencode 的其他 session（如 TUI 启动的、或另一个 chat 触发的）在工程 X 里
 * 执行了工具调用，事件来到我们插件。
 *
 * 此时我们应该给这个 chat 发一条简短通知："🔔 [backend] tool: bash 完成"。
 *
 * 节流：同一 chat 5 秒内最多 1 条通知（避免 API 限流 + 消息轰炸）。
 */
import type * as Lark from "@larksuiteoapi/node-sdk"
import { TtlMap } from "../utils/ttl-map.js"
import type { LogFn } from "../types.js"

const NOTIFY_TTL = 60_000
const NOTIFY_RATE_LIMIT_MS = 5_000

const lastNotifyAt = new TtlMap<number>(NOTIFY_TTL)

/**
 * 尝试给 chat 发一条后台通知，受节流控制。
 *
 * @param summary 简短描述（不含前缀，前缀在这里加）
 * @returns true = 实际发送；false = 被节流或失败
 */
export async function maybeSendBackgroundNotification(
  larkClient: InstanceType<typeof Lark.Client>,
  chatId: string,
  projectName: string,
  sessionId: string,
  summary: string,
  log: LogFn,
): Promise<boolean> {
  const now = Date.now()
  const last = lastNotifyAt.get(chatId)
  if (last && now - last < NOTIFY_RATE_LIMIT_MS) {
    return false
  }

  const text = `🔔 [${projectName}] ${summary}\n` +
               `session: ${sessionId.slice(0, 8)}…`
  try {
    const res = await larkClient.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      params: { receive_id_type: "chat_id" },
    })
    if (res.code === 0) {
      lastNotifyAt.set(chatId, now)
      return true
    }
    log("warn", "background notification 非 0", { chatId, code: res.code, msg: res.msg })
    return false
  } catch (err) {
    log("error", "background notification 异常", {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/** 测试用：重置节流状态。 */
export function _resetNotificationThrottle(): void {
  lastNotifyAt.clear()
}
