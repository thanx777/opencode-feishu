/**
 * 历史对话命令处理
 *
 * 支持的命令：
 * - /history 或 /history 10：显示当前工程下最近 N 条会话（默认 10）
 * - /history view <编号>：查看特定会话的消息内容
 *
 * 重要：`/history` 严格按当前 chat 绑定的工程过滤。
 * 群聊 "后端开发" 看到的是 backend/ 下的会话，与 "前端开发" 完全隔离。
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { LogFn } from "../types.js"
import { buildHistoryCard, buildSessionDetailCard, buildErrorCard } from "./cards.js"
import { HISTORY_HINTS, GENERAL_HINTS, mergeHints } from "./command-hints.js"
import { getChatProject } from "./chat-project-map.js"

export interface HistoryCommandDeps {
  client: OpencodeClient
  log: LogFn
  /** chat 信息用于查询 binding */
  chatType: "p2p" | "group"
  chatId: string
  /** 兜底目录（未绑定时使用） */
  fallbackDirectory?: string
}

/**
 * 处理历史对话命令，返回卡片 JSON
 */
export async function handleHistoryCommand(
  args: string,
  deps: HistoryCommandDeps,
): Promise<object> {
  const { client, log, chatType, chatId, fallbackDirectory } = deps
  const hints = mergeHints(HISTORY_HINTS, GENERAL_HINTS)

  // 解析当前 chat 实际工作的目录（绑定优先，否则回退到 feishu.json.directory）
  const bound = getChatProject(chatType, chatId)
  const effectiveDirectory = bound?.path || fallbackDirectory || ""
  const query = effectiveDirectory ? { directory: effectiveDirectory } : undefined

  // 顶部标记当前作用范围
  const scopeLabel = bound
    ? `**当前工程：** \`${bound.name}\` (\`${bound.path}\`)`
    : effectiveDirectory
    ? `**当前目录：** \`${effectiveDirectory}\`（未绑定工程，使用默认根）`
    : "**当前目录：** 根目录"

  try {
    // 查看特定会话详情：/history view <编号>
    if (args.startsWith("view ")) {
      const sessionIndex = parseInt(args.replace("view ", "")) - 1
      const { data: sessions } = await client.session.list({ query })

      if (sessions && sessionIndex >= 0 && sessionIndex < sessions.length) {
        const session = sessions[sessionIndex]
        const { data: messages } = await client.session.messages({
          path: { id: session.id },
          query,
        })
        return buildSessionDetailCard(session, messages || [], hints)
      }

      return buildErrorCard(
        "无效的会话编号",
        `请输入 1-${sessions?.length || 0} 之间的数字`,
      )
    }

    // 显示最近 N 条会话：/history 或 /history <数量>
    let count = 10
    if (args && args.trim() !== "") {
      const parsed = parseInt(args)
      if (!isNaN(parsed) && parsed > 0) {
        count = parsed
      }
    }

    const { data: sessions } = await client.session.list({ query })
    const recentSessions = (sessions || []).slice(0, count)

    return buildHistoryCardWithScope(recentSessions, sessions?.length || 0, scopeLabel, hints)
  } catch (error) {
    log("error", "处理历史命令失败", {
      error: error instanceof Error ? error.message : String(error),
    })
    return buildErrorCard(
      "获取历史记录失败",
      error instanceof Error ? error.message : String(error),
    )
  }
}

function buildHistoryCardWithScope(
  sessions: import("@opencode-ai/sdk").Session[],
  totalCount: number,
  scopeLabel: string,
  hints: ReturnType<typeof mergeHints>,
): object {
  const sessionList = sessions
    .map((s, i) => {
      const date = s.time?.created
        ? new Date(s.time.created).toLocaleString("zh-CN")
        : "未知时间"
      const title = s.title || "无标题"
      const id = s.id?.slice(0, 20) || "unknown"
      return `${i + 1}. [${date}] ${title}\n   ID: \`${id}\``
    })
    .join("\n\n")

  return {
    header: {
      title: { tag: "plain_text", content: "📜 历史会话" },
      template: "green",
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: scopeLabel },
      },
      { tag: "hr" },
      {
        tag: "div",
        text: { tag: "lark_md", content: `**共 ${totalCount} 个会话**` },
      },
      { tag: "hr" },
      {
        tag: "div",
        text: { tag: "lark_md", content: sessionList || "暂无会话记录" },
      },
      ...(hints ? [{ tag: "hr" } as const, {
        tag: "note",
        elements: [
          { tag: "lark_md", content: `📌 **可用命令：**\n${hints.map(h => `• \`${h.cmd}\` - ${h.desc}`).join("\n")}` },
        ],
      }] : []),
    ],
  }
}
