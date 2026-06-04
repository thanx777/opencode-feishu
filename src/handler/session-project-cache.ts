/**
 * sessionId → 工程目录 缓存。
 *
 * 用于事件路由：拿到 sessionId 之后能查到它在哪个工程目录里，
 * 进而查到哪些飞书 chat 绑定了这个工程。
 *
 * 数据来源：
 * - 主动记录：`chat.ts` 在 `getOrCreateSession` 后调用 recordSessionDirectory
 * - 懒加载：缓存未命中时调 `client.session.get` 查 opencode 的 session 元数据
 *
 * 借鉴自 grinev/opencode-telegram-bot 的 "Track Existing Session" 模式
 * —— 通过 session 元数据把 session 关联回 project 路径。
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import { TtlMap } from "../utils/ttl-map.js"
import type { LogFn } from "../types.js"

/** 24 小时 TTL —— 与 chatProjectMap / sessionCache 一致。 */
const SESSION_DIR_TTL = 24 * 60 * 60 * 1_000

const sessionDirectoryMap = new TtlMap<string>(SESSION_DIR_TTL)

/** 主动记录一个 session 所属的工程目录。 */
export function recordSessionDirectory(sessionId: string, directory: string): void {
  if (!sessionId || !directory) return
  sessionDirectoryMap.set(sessionId, directory)
}

/** 读取缓存中的目录。 */
export function getSessionDirectory(sessionId: string): string | undefined {
  return sessionDirectoryMap.get(sessionId)
}

/**
 * 解析 session 所属的工程目录：先查缓存，未命中时调 opencode API。
 * API 失败返回 undefined（不抛错），调用方应静默跳过。
 */
export async function resolveSessionDirectory(
  client: OpencodeClient,
  sessionId: string,
  log: LogFn,
): Promise<string | undefined> {
  if (!sessionId) return undefined
  const cached = getSessionDirectory(sessionId)
  if (cached) return cached

  try {
    const res = await client.session.get({ path: { id: sessionId } })
    const data = res?.data as { directory?: string } | undefined
    if (data?.directory) {
      recordSessionDirectory(sessionId, data.directory)
      return data.directory
    }
  } catch (err) {
    log("warn", "resolveSessionDirectory: opencode API failed", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return undefined
}
