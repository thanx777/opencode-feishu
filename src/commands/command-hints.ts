/**
 * 命令提示数据
 *
 * 为各种卡片提供命令速查提示
 */

export interface CommandHint {
  cmd: string
  desc: string
}

/** 工程绑定命令（替代旧 /workspace） */
export const DIR_HINTS: CommandHint[] = [
  { cmd: "/dir", desc: "查看当前聊天绑定的工程" },
  { cmd: "/dir list", desc: "列出所有可绑定的工程" },
  { cmd: "/dir <name>", desc: "把此聊天绑定到 <name> 工程" },
]

/** 解除绑定命令 */
export const UNBIND_HINTS: CommandHint[] = [
  { cmd: "/unbind", desc: "解除当前聊天的工程绑定" },
]

/** 历史会话相关命令 */
export const HISTORY_HINTS: CommandHint[] = [
  { cmd: "/history", desc: "查看当前工程下最近 10 个会话" },
  { cmd: "/history <N>", desc: "查看最近 N 个会话" },
  { cmd: "/history view <N>", desc: "查看会话详情" },
]

/** 通用命令（用于综合卡片） */
export const GENERAL_HINTS: CommandHint[] = [
  { cmd: "/new", desc: "在当前工程创建新会话" },
  { cmd: "/dir", desc: "查看/切换工程" },
  { cmd: "/mode", desc: "切换 Plan/Build 模式" },
  { cmd: "/model", desc: "查看/切换 AI 模型" },
  { cmd: "/unbind", desc: "解除工程绑定" },
  { cmd: "/history", desc: "查看历史会话" },
]

/**
 * 构建命令提示区域
 */
export function buildCommandHintsSection(hints: CommandHint[]): object {
  const hintText = hints
    .map(h => `• \`${h.cmd}\` - ${h.desc}`)
    .join("\n")

  return {
    tag: "note",
    elements: [
      { tag: "lark_md", content: `📌 **可用命令：**\n${hintText}` },
    ],
  }
}

/**
 * 合并多个命令提示（去重）
 */
export function mergeHints(...hintArrays: CommandHint[][]): CommandHint[] {
  const seen = new Set<string>()
  const result: CommandHint[] = []

  for (const hints of hintArrays) {
    for (const hint of hints) {
      if (!seen.has(hint.cmd)) {
        seen.add(hint.cmd)
        result.push(hint)
      }
    }
  }

  return result
}
