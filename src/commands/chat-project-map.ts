/**
 * 飞书 chat ↔ opencode 工程 绑定关系映射。
 *
 * 设计目标（V1）：
 * - 每个飞书聊天（单聊/群聊）可绑定一个工程目录
 * - 绑定后该聊天的所有消息路由到绑定目录的 session
 * - 24 小时 TTL 防止"被遗忘的绑定"长期累积
 * - 重启后 binding 丢失（内存态），但飞书 session 不丢失（opencode 持久化）
 *
 * 借鉴自 grinev/opencode-telegram-bot 的 "Per-thread session isolation" 模式
 * 以及 kortix-ai/opencode-channels 的 "per-thread sessions" 设计。
 */
import { TtlMap } from "../utils/ttl-map.js"

/** chatId/key 维度的 binding TTL。24 小时无活动后失效。 */
const CHAT_PROJECT_TTL = 24 * 60 * 60 * 1_000

/** 绑定项。 */
export interface ChatProjectBinding {
  /** 绑定的工程绝对路径。 */
  path: string
  /** 工程显示名（basename 或 "(root)"）。 */
  name: string
  /** 绑定时间戳（ms）。 */
  boundAt: number
}

/** 内部存储：chatKey → binding。 */
const chatProjectMap = new TtlMap<ChatProjectBinding>(CHAT_PROJECT_TTL)

/**
 * 构建 binding 用的业务键。
 *
 * - p2p：`p2p:<userId>` — 同一用户的多设备飞书账号视为同一 session
 * - group：`group:<chatId>` — 群级隔离，不区分群成员
 */
export function buildChatKey(chatType: "p2p" | "group", id: string): string {
  return `${chatType}:${id}`
}

/** 读取当前 chat 的 binding，未绑定返回 undefined。 */
export function getChatProject(
  chatType: "p2p" | "group",
  id: string,
): ChatProjectBinding | undefined {
  return chatProjectMap.get(buildChatKey(chatType, id))
}

/** 写入或刷新 binding。 */
export function setChatProject(
  chatType: "p2p" | "group",
  id: string,
  binding: ChatProjectBinding,
): void {
  chatProjectMap.set(buildChatKey(chatType, id), binding)
}

/** 清除 chat 的 binding。 */
export function clearChatProject(chatType: "p2p" | "group", id: string): void {
  chatProjectMap.delete(buildChatKey(chatType, id))
}

/**
 * 遍历所有活跃 binding。
 *
 * 主要用于：
 * - background notifications：找"哪些 chat 绑定了这个 session 所在的工程"
 * - pinned status：找"哪些 chat 应该有 pinned 消息"
 */
export function listAllChatProjects(): Array<{ key: string; binding: ChatProjectBinding; chatType: "p2p" | "group"; id: string }> {
  return chatProjectMap.entries().map(([key, binding]) => {
    const colonIdx = key.indexOf(":")
    const chatType = key.slice(0, colonIdx) as "p2p" | "group"
    const id = key.slice(colonIdx + 1)
    return { key, binding, chatType, id }
  })
}
