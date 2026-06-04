/**
 * 换绑上下文转移模块。
 *
 * 当用户通过 /dir 或 /unbind 切换工程时，从旧 session 提取最后 N 条对话文本，
 * 注入到新 session 作为首条上下文，避免切换工程后 AI 丢失之前讨论的记忆。
 */
import type { OpencodeClient } from "@opencode-ai/sdk"

/** 换绑前提取上下文时默认抓取的消息数（文本部分）。 */
const DEFAULT_MAX_MESSAGES = 15

/** sessionKey → 等待注入的上下文文本 */
const pendingContextMap = new Map<string, string>()

/**
 * 从旧 session 中提取最后 N 条消息的文本内容，格式化为上下文摘要。
 *
 * @param client   OpenCode SDK client
 * @param sessionId 旧 session ID
 * @param directory 工程目录（用于 query 参数）
 * @param options.maxMessages 最大抓取消息数，默认 15
 * @returns 格式化后的上下文文本；无可用内容时返回 null
 */
export async function extractSessionContext(
  client: OpencodeClient,
  sessionId: string,
  directory: string | undefined,
  options?: { maxMessages?: number },
): Promise<string | null> {
  const limit = options?.maxMessages ?? DEFAULT_MAX_MESSAGES
  const query = directory ? { directory, limit } : { limit }

  let messages: Array<{ info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }>
  try {
    const resp = await client.session.messages({ path: { id: sessionId }, query })
    messages = (resp as { data?: typeof messages })?.data ?? []
  } catch {
    return null
  }

  if (!messages.length) return null

  // 提取文本 parts，按 [角色]: 内容 格式拼接
  const lines: string[] = []
  let totalChars = 0
  const maxChars = 3000 // 防止上下文过长撑爆 prompt

  for (const msg of messages) {
    const role = msg.info?.role ?? "unknown"
    const label = role === "user" ? "用户" : role === "assistant" ? "AI" : role

    for (const part of msg.parts ?? []) {
      if (part.type !== "text" || !part.text?.trim()) continue
      const line = `[${label}]: ${part.text.trim()}`
      totalChars += line.length
      if (totalChars > maxChars) {
        lines.push("…（内容过长，已截断）")
        break
      }
      lines.push(line)
    }
    if (totalChars > maxChars) break
  }

  if (!lines.length) return null

  const conversationText = lines.join("\n")
  const contextHeader =
    `📋 来自上一工程的上下文摘要（${directory ?? "未知路径"} → 已切换）\n\n---\n\n`

  return contextHeader + conversationText + "\n\n---"
}

/**
 * 暂存待注入的上下文文本，供下次消息创建 session 后消费。
 */
export function setPendingContext(sessionKey: string, context: string): void {
  pendingContextMap.set(sessionKey, context)
}

/**
 * 消费并清除暂存的上下文文本。
 * @returns 上下文文本，若无暂存则返回 undefined
 */
export function consumePendingContext(sessionKey: string): string | undefined {
  const ctx = pendingContextMap.get(sessionKey)
  pendingContextMap.delete(sessionKey)
  return ctx
}
