/**
 * 飞书交互式卡片模板构建函数
 *
 * 为 /dir, /unbind, /history 命令提供结构化卡片回复
 */
import type { Session, Message, Part } from "@opencode-ai/sdk"
import type { CommandHint } from "./command-hints.js"
import { buildCommandHintsSection } from "./command-hints.js"
import type { ScannedWorkspace } from "../utils/scan-workspaces.js"
import type { ChatProjectBinding } from "./chat-project-map.js"
import { dirname, join } from "node:path"

/**
 * 当前工作区信息（用于卡片顶部）
 */
export interface CurrentWorkspaceInfo {
  /** 解析后的真实路径 */
  path: string
  /** 该工作区下的最近会话 */
  sessions: Session[]
  /** 会话总数（sessions 可能是截断后的） */
  totalSessionCount: number
}

/**
 * 其他可用工作区（用于卡片底部"切换"区）
 */
export interface OtherWorkspace {
  /** 切换编号（用于 /workspace N） */
  index: number
  /** 解析后的真实路径 */
  path: string
}

/**
 * 工作区卡片（对齐桌面端：当前工作区 + 会话 + 其他工作区）
 */
export function buildWorkspaceCard(
  current: CurrentWorkspaceInfo,
  others: OtherWorkspace[],
  commandHints?: CommandHint[],
): object {
  const elements: object[] = []

  // 1. 当前工作区头部
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**📂 当前工作区**\n\`${current.path}\``,
    },
  })

  // 2. 当前工作区下的会话
  if (current.sessions.length > 0) {
    const sessionList = current.sessions
      .map((s, i) => {
        const date = s.time?.updated
          ? new Date(s.time.updated).toLocaleString("zh-CN")
          : ""
        const title = s.title || "无标题"
        return `${i + 1}. ${title}${date ? `  _${date}_` : ""}`
      })
      .join("\n")
    elements.push({ tag: "hr" })
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**💬 最近会话 (${current.sessions.length}/${current.totalSessionCount})**\n${sessionList}`,
      },
    })
  } else {
    elements.push({ tag: "hr" })
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: "_💬 当前工作区暂无会话_" },
    })
  }

  // 3. 其他工作区
  if (others.length > 0) {
    const otherList = others
      .map((o) => `${o.index}. \`${o.path}\``)
      .join("\n")
    elements.push({ tag: "hr" })
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**📁 其他工作区 (${others.length} 个)**\n${otherList}`,
      },
    })
  }

  // 4. 命令提示
  if (commandHints) {
    elements.push({ tag: "hr" })
    elements.push(buildCommandHintsSection(commandHints))
  }

  return {
    header: {
      title: { tag: "plain_text", content: "📋 工作区" },
      template: "blue",
    },
    elements,
  }
}

/**
 * 历史会话列表卡片
 */
export function buildHistoryCard(
  sessions: Session[],
  totalCount: number,
  commandHints?: CommandHint[],
): object {
  // 构建会话列表内容
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
      title: { tag: "plain_text", content: "📜 最近会话列表" },
      template: "green",
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: `**共 ${totalCount} 个会话**` },
      },
      { tag: "hr" },
      {
        tag: "div",
        text: { tag: "lark_md", content: sessionList || "暂无会话记录" },
      },
      ...(commandHints ? [{ tag: "hr" } as const, buildCommandHintsSection(commandHints)] : []),
    ],
  }
}

/**
 * 会话详情卡片
 */
export function buildSessionDetailCard(
  session: Session,
  messages: Array<{ info: Message; parts: Part[] }>,
  commandHints?: CommandHint[],
): object {
  const date = session.time?.created
    ? new Date(session.time.created).toLocaleString("zh-CN")
    : "未知时间"
  const title = session.title || "无标题"

  // 构建消息列表（最多显示 10 条）
  const recentMessages = messages.slice(-10)
  const messageList = recentMessages
    .map((msg) => {
      const role = msg.info?.role === "user" ? "👤 用户" : "🤖 AI"
      const content = (msg.parts || [])
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text?: string }).text || "")
        .join("\n")
        .slice(0, 200) // 截断过长内容
      return `**${role}:**\n${content || "(无文本内容)"}`
    })
    .join("\n\n")

  const hasMore = messages.length > 10
  const moreHint = hasMore ? `\n\n*... 还有 ${messages.length - 10} 条更早的消息*` : ""

  return {
    header: {
      title: { tag: "plain_text", content: `💬 ${title}` },
      template: "purple",
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: `**时间:** ${date}\n**消息数:** ${messages.length}` },
      },
      { tag: "hr" },
      {
        tag: "div",
        text: { tag: "lark_md", content: messageList + moreHint || "暂无消息记录" },
      },
      ...(commandHints ? [{ tag: "hr" } as const, buildCommandHintsSection(commandHints)] : []),
    ],
  }
}

/**
 * 错误提示卡片
 */
export function buildErrorCard(title: string, message: string): object {
  return {
    header: {
      title: { tag: "plain_text", content: `❌ ${title}` },
      template: "red",
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: message },
      },
    ],
  }
}

/**
 * `/dir list` 卡片：顶层文件夹浏览器。
 *
 * 显示每个 workspaceRoot 作为文件夹按钮，点击进入浏览子目录。
 */
export function buildDirListCard(
  workspaces: ScannedWorkspace[],
  roots: ReadonlyArray<string>,
  chatId?: string,
): object {
  const elements: object[] = []

  if (roots.length === 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "⚠️ 没有配置 workspaceRoots，请在飞书插件配置中添加。",
      },
    })
  } else {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "**📂 选择工作区根目录：**",
      },
    })

    // 每个 root 一个按钮，点击进入浏览
    if (chatId) {
      for (const root of roots) {
        const displayName = root.split(/[/\\]/).pop() ?? root
        elements.push({
          tag: "column_set",
          flex_mode: "none",
          background_style: "default",
          columns: [{
            tag: "column",
            width: "weighted",
            weight: 1,
            elements: [{
              tag: "button",
              text: { tag: "plain_text", content: `📂 ${displayName}` },
              type: "primary",
              value: {
                action: "send_message",
                chatId,
                text: `/dir browse ${root}`,
              },
            }],
          }],
        })
      }
    } else {
      // 无 chatId 时显示文本列表
      for (const root of roots) {
        elements.push({
          tag: "div",
          text: { tag: "lark_md", content: `• \`${root}\`` },
        })
      }
    }
  }

  return {
    header: {
      title: { tag: "plain_text", content: "📋 选择工作区" },
      template: "blue",
    },
    elements,
  }
}

/**
 * `/dir browse <path>` 卡片：文件夹浏览器。
 *
 * - 顶部：返回上级按钮（如果不在 root 层）
 * - 中间：子目录按钮列表
 * - 底部：确定按钮（绑定当前目录作为工作区）
 */
export function buildBrowseCard(
  currentPath: string,
  subdirs: string[],
  roots: ReadonlyArray<string>,
  chatId: string,
): object {
  const elements: object[] = []
  const displayName = currentPath.split(/[/\\]/).pop() ?? currentPath

  // 当前路径
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**📁 ${displayName}**\n\`${currentPath}\``,
    },
  })

  elements.push({ tag: "hr" })

  // 返回按钮：如果当前路径不是 root 本身，返回上级
  const normalizedCurrent = currentPath.toLowerCase().replace(/\\/g, "/")
  const isRoot = roots.some((r) => r.toLowerCase().replace(/\\/g, "/") === normalizedCurrent)

  if (!isRoot) {
    const parentPath = dirname(currentPath)
    // 检查上级是否还在某个 root 下
    const normalizedParent = parentPath.toLowerCase().replace(/\\/g, "/")
    const parentInRoots = roots.some((r) => {
      const nr = r.toLowerCase().replace(/\\/g, "/")
      return normalizedParent === nr || normalizedParent.startsWith(nr + "/")
    })
    if (parentInRoots) {
      elements.push({
        tag: "column_set",
        flex_mode: "none",
        background_style: "default",
        columns: [{
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [{
            tag: "button",
            text: { tag: "plain_text", content: "⬆️ 返回上级" },
            type: "default",
            value: {
              action: "send_message",
              chatId,
              text: `/dir browse ${parentPath}`,
            },
          }],
        }],
      })
    }
  }

  // 子目录按钮
  if (subdirs.length > 0) {
    for (const dir of subdirs) {
      const fullPath = join(currentPath, dir)
      elements.push({
        tag: "column_set",
        flex_mode: "none",
        background_style: "default",
        columns: [{
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [{
            tag: "button",
            text: { tag: "plain_text", content: `📁 ${dir}` },
            type: "default",
            value: {
              action: "send_message",
              chatId,
              text: `/dir browse ${fullPath}`,
            },
          }],
        }],
      })
    }
  } else {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: "_（此目录下没有子目录）_" },
    })
  }

  elements.push({ tag: "hr" })

  // 确定按钮：绑定当前目录
  elements.push({
    tag: "column_set",
    flex_mode: "none",
    background_style: "default",
    columns: [{
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [{
        tag: "button",
        text: { tag: "plain_text", content: `✅ 确定 - 绑定 ${displayName}` },
        type: "primary",
        value: {
          action: "send_message",
          chatId,
          text: `/dir bind ${currentPath}`,
        },
      }],
    }],
  })

  return {
    header: {
      title: { tag: "plain_text", content: "📂 浏览目录" },
      template: "blue",
    },
    elements,
  }
}

/**
 * `/dir` (无参) 或 `/dir <name>` 切换成功后的当前工程卡片。
 */
export function buildCurrentDirCard(
  info: ChatProjectBinding,
  commandHints?: CommandHint[],
): object {
  const boundAt = new Date(info.boundAt).toLocaleString("zh-CN")
  return {
    header: {
      title: { tag: "plain_text", content: "📂 当前工程" },
      template: "green",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**工程名：** \`${info.name}\`\n**路径：** \`${info.path}\`\n**绑定时间：** ${boundAt}`,
        },
      },
      { tag: "hr" },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "💡 后续消息将进入此工程的新会话（`/dir <name>` 切换或 `/unbind` 解除）。",
        },
      },
      ...(commandHints ? [buildCommandHintsSection(commandHints)] : []),
    ],
  }
}

/**
 * pinned live status 卡片：每绑定工程的 chat 顶部展示。
 *
 * - 工程名 + 路径
 * - 当前 session 状态（空闲/运行中/已绑定未启动）
 * - 最近一次 assistant 摘要
 */
export function buildPinnedStatusCard(
  info: ChatProjectBinding,
  sessionState: { status: "idle" | "running" | "unknown"; sessionId?: string; lastActivityAt?: number; lastSnippet?: string },
): object {
  const stateEmoji = sessionState.status === "running" ? "🔄" : sessionState.status === "idle" ? "✅" : "⚪"
  const stateText = sessionState.status === "running" ? "运行中" : sessionState.status === "idle" ? "空闲" : "未启动"
  const lastActivity = sessionState.lastActivityAt
    ? new Date(sessionState.lastActivityAt).toLocaleTimeString("zh-CN")
    : "—"
  const snippet = sessionState.lastSnippet
    ? `\n💬 ${sessionState.lastSnippet.slice(0, 100)}${sessionState.lastSnippet.length > 100 ? "…" : ""}`
    : ""
  return {
    header: {
      title: { tag: "plain_text", content: `📌 ${info.name} 实时状态` },
      template: "blue",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**工程：** \`${info.path}\`\n**状态：** ${stateEmoji} ${stateText}\n**最后活动：** ${lastActivity}${snippet}`,
        },
      },
    ],
  }
}
