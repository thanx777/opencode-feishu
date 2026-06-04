/**
 * `/unbind` 命令处理
 *
 * 解除当前聊天的工程绑定。后续消息将回退到 feishu.json.directory（默认根）。
 */
import type * as Lark from "@larksuiteoapi/node-sdk"
import type { LogFn } from "../types.js"
import { getChatProject, clearChatProject, buildChatKey } from "./chat-project-map.js"
import { buildErrorCard } from "./cards.js"
import { DIR_HINTS, GENERAL_HINTS, mergeHints } from "./command-hints.js"
import { getPinnedState, clearPinnedState, deletePinnedMessage } from "../handler/pinned-status.js"

export interface UnbindCommandDeps {
  chatType: "p2p" | "group"
  chatId: string
  fallbackDirectory: string
  log: LogFn
  larkClient?: InstanceType<typeof Lark.Client>
}

export interface UnbindCommandResult {
  card: object
  /** 调用方需要 invalidate session。 */
  unbind?: boolean
}

export function handleUnbindCommand(deps: UnbindCommandDeps): UnbindCommandResult {
  const { chatType, chatId, fallbackDirectory, log, larkClient } = deps
  const current = getChatProject(chatType, chatId)

  if (!current) {
    log("info", "/unbind: 聊天未绑定", { chatType, chatId })
    return {
      card: buildErrorCard(
        "未绑定",
        "此聊天没有绑定任何工程，无需 unbind。\n\n发送 `/dir list` 查看可用工程。",
      ),
    }
  }

  clearChatProject(chatType, chatId)

  // PR2: 删除 pinned 状态消息
  const chatKey = buildChatKey(chatType, chatId)
  const pinned = getPinnedState(chatKey)
  if (pinned && larkClient) {
    void deletePinnedMessage(larkClient, chatId, pinned.messageId, log)
    clearPinnedState(chatKey)
  }

  log("info", "/unbind: 解除绑定", { chatType, chatId, from: current.path, fallback: fallbackDirectory })

  return {
    card: {
      header: {
        title: { tag: "plain_text", content: "✅ 已解除绑定" },
        template: "green",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**解除：** \`${current.path}\`\n**回退：** \`${fallbackDirectory}\`\n\n后续消息将进入根目录的新会话。`,
          },
        },
        { tag: "hr" },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "💡 再次发送 `/dir list` 选择工程。",
          },
        },
        {
          tag: "note",
          elements: [
            { tag: "lark_md", content: mergeHintsToMarkdown(mergeHints(DIR_HINTS, GENERAL_HINTS)) },
          ],
        },
      ],
    },
    unbind: true,
  }
}

function mergeHintsToMarkdown(hints: ReadonlyArray<{ cmd: string; desc: string }>): string {
  const text = hints.map((h) => `• \`${h.cmd}\` - ${h.desc}`).join("\n")
  return `📌 **可用命令：**\n${text}`
}
