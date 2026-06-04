/**
 * Pinned live status：每个绑定工程的飞书 chat 顶部都有一条"实时状态"消息。
 *
 * 借鉴自 grinev/opencode-telegram-bot 的 "Live status (pinned message)" 模式：
 * - 每个绑定的 chat 都有一条 pinned text message（普通 text 消息，不是 Feishu 概念上的"置顶"）
 * - 消息内容：工程名 + 路径 + 当前状态 + 最后活动 + 最后一条 assistant snippet
 * - 在 session 事件到来时更新（带节流，避免 Feishu API 限流）
 *
 * V1 简化：
 * - 用普通 text 消息，不用 CardKit 2.0（更新更简单）
 * - 状态枚举只有 4 种：idle / running / error / unknown
 * - 节流 1 秒（同一 chat 的状态消息每 1s 最多更新 1 次）
 */
import type * as Lark from "@larksuiteoapi/node-sdk"
import { TtlMap } from "../utils/ttl-map.js"
import type { LogFn } from "../types.js"

/** Pinned 状态机的取值。 */
export type PinnedStatusState = "idle" | "running" | "error" | "unknown"

/** 每个 chat 一条状态。 */
export interface PinnedState {
  /** 飞书 message_id，用于后续 update。 */
  messageId: string
  /** 当前状态。 */
  status: PinnedStatusState
  /** 最后一条 assistant 文本摘要。 */
  lastSnippet: string
  /** 最后活动时间戳（ms）。 */
  lastActivityAt: number
  /** 上次实际发送 update 的时间（用于节流）。 */
  lastSentAt: number
}

const PINNED_TTL = 24 * 60 * 60 * 1_000
const UPDATE_THROTTLE_MS = 1_000

const pinnedByChat = new TtlMap<PinnedState>(PINNED_TTL)

export function getPinnedState(chatKey: string): PinnedState | undefined {
  return pinnedByChat.get(chatKey)
}

export function setPinnedState(chatKey: string, state: PinnedState): void {
  pinnedByChat.set(chatKey, state)
}

export function clearPinnedState(chatKey: string): void {
  pinnedByChat.delete(chatKey)
}

export function listAllPinnedStates(): Array<{ chatKey: string; state: PinnedState }> {
  return pinnedByChat.entries().map(([chatKey, state]) => ({ chatKey, state }))
}

/**
 * 构造 pinned 状态消息的文本内容。
 */
export function buildPinnedText(
  projectName: string,
  projectPath: string,
  state: PinnedState,
): string {
  const stateEmoji =
    state.status === "running" ? "🔄" :
    state.status === "idle" ? "✅" :
    state.status === "error" ? "❌" : "⚪"
  const stateText =
    state.status === "running" ? "运行中" :
    state.status === "idle" ? "空闲" :
    state.status === "error" ? "出错" : "未启动"
  const lastActivity = state.lastActivityAt
    ? new Date(state.lastActivityAt).toLocaleTimeString("zh-CN")
    : "—"
  const snippet = state.lastSnippet
    ? `\n💬 ${state.lastSnippet.slice(0, 150)}${state.lastSnippet.length > 150 ? "…" : ""}`
    : ""
  return `📌 ${projectName} 实时状态\n` +
         `工程: ${projectPath}\n` +
         `状态: ${stateEmoji} ${stateText}\n` +
         `最后活动: ${lastActivity}${snippet}`
}

/**
 * 创建 pinned 状态消息（在 chat 绑定工程时调用）。
 * 返回创建的 messageId，失败返回 undefined。
 */
export async function createPinnedMessage(
  larkClient: InstanceType<typeof Lark.Client>,
  chatId: string,
  projectName: string,
  projectPath: string,
  log: LogFn,
): Promise<string | undefined> {
  const initial: PinnedState = {
    messageId: "",
    status: "unknown",
    lastSnippet: "",
    lastActivityAt: Date.now(),
    lastSentAt: 0,
  }
  const text = buildPinnedText(projectName, projectPath, initial)
  try {
    const res = await larkClient.im.message.create({
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      params: { receive_id_type: "chat_id" },
    })
    if (res.code !== 0 || !res.data?.message_id) {
      log("warn", "createPinnedMessage 失败", { chatId, code: res.code, msg: res.msg })
      return undefined
    }
    return res.data.message_id
  } catch (err) {
    log("error", "createPinnedMessage 异常", {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

/**
 * 更新 pinned 状态消息。带节流：同 chat 在 1s 内只 update 一次。
 */
export async function updatePinnedMessage(
  larkClient: InstanceType<typeof Lark.Client>,
  chatId: string,
  messageId: string,
  projectName: string,
  projectPath: string,
  state: PinnedState,
  log: LogFn,
): Promise<{ sent: boolean; nextState: PinnedState }> {
  // 节流：如果刚刚发过，只更新本地 state，不调飞书 API
  if (Date.now() - state.lastSentAt < UPDATE_THROTTLE_MS) {
    return { sent: false, nextState: { ...state, lastActivityAt: Date.now() } }
  }

  const next: PinnedState = { ...state, lastActivityAt: Date.now(), lastSentAt: Date.now() }
  const text = buildPinnedText(projectName, projectPath, next)
  try {
    await larkClient.im.message.update({
      path: { message_id: messageId },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    })
    return { sent: true, nextState: next }
  } catch (err) {
    log("warn", "updatePinnedMessage 失败", {
      chatId, messageId,
      error: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, nextState: next }
  }
}

/**
 * 删除 pinned 状态消息（在 chat 解除绑定或切换工程时调用）。
 * 失败仅记录日志，不抛错。
 */
export async function deletePinnedMessage(
  larkClient: InstanceType<typeof Lark.Client>,
  chatId: string,
  messageId: string,
  log: LogFn,
): Promise<void> {
  try {
    await larkClient.im.message.delete({
      path: { message_id: messageId },
    })
  } catch (err) {
    log("warn", "deletePinnedMessage 失败", {
      chatId, messageId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
