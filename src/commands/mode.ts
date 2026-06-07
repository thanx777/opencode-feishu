/**
 * `/mode` 命令处理
 *
 * 切换 OpenCode 的默认 agent（plan / build）。
 * - `/mode`       显示当前模式 + 选择按钮
 * - `/mode plan`  切换到 plan 模式
 * - `/mode build` 切换到 build 模式
 *
 * 实现方式：写入 per-sessionKey 的 agent 覆盖，
 * 在 promptAsync 调用时传入 body.agent，不依赖 config.update。
 */
import type { LogFn } from "../types.js"
import { setSessionAgentOverride } from "../handler/chat.js"

export interface ModeCommandDeps {
  log: LogFn
  chatId: string
  sessionKey: string
}

export interface ModeCommandResult {
  card: object
}

/**
 * 处理 /mode 命令
 */
export async function handleModeCommand(
  args: string,
  deps: ModeCommandDeps,
): Promise<ModeCommandResult> {
  const { log, chatId } = deps
  const trimmed = args.trim().toLowerCase()

  // /mode plan 或 /mode build：切换模式
  if (trimmed === "plan" || trimmed === "build") {
    return switchMode(trimmed, deps)
  }

  // /mode（无参数）：显示当前模式 + 按钮
  // 从 sessionOverrides 读取当前覆盖，无覆盖则默认 build
  const { getSessionOverrides } = await import("../handler/chat.js")
  const overrides = getSessionOverrides(deps.sessionKey)
  const current = overrides?.agent ?? "build"

  log("info", "/mode: 显示当前模式", { current })

  return {
    card: buildModeCard(current, chatId),
  }
}

function switchMode(mode: string, deps: ModeCommandDeps): ModeCommandResult {
  const { log, sessionKey } = deps

  setSessionAgentOverride(sessionKey, mode)

  log("info", `/mode: 切换成功`, { mode })

  return {
    card: buildModeSwitchedCard(mode),
  }
}

function buildModeCard(current: string, chatId: string): object {
  const isPlan = current === "plan"
  const isBuild = current === "build"

  return {
    header: {
      title: { tag: "plain_text", content: "🧭 选择模式" },
      template: "blue",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `当前模式：**${isPlan ? "📋 Plan（规划）" : isBuild ? "🔨 Build（构建）" : current}**`,
        },
      },
      { tag: "hr" },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "**📋 Plan 模式**：只分析和规划，不修改文件\n**🔨 Build 模式**：直接编写和修改代码",
        },
      },
      { tag: "hr" },
      {
        tag: "column_set",
        flex_mode: "none",
        background_style: "default",
        columns: [
          {
            tag: "column",
            width: "weighted",
            weight: 1,
            elements: [{
              tag: "button",
              text: { tag: "plain_text", content: isPlan ? "✅ Plan（当前）" : "📋 Plan" },
              type: isPlan ? "primary" : "default",
              disabled: isPlan,
              value: {
                action: "send_message",
                chatId,
                text: "/mode plan",
              },
            }],
          },
          {
            tag: "column",
            width: "weighted",
            weight: 1,
            elements: [{
              tag: "button",
              text: { tag: "plain_text", content: isBuild ? "✅ Build（当前）" : "🔨 Build" },
              type: isBuild ? "primary" : "default",
              disabled: isBuild,
              value: {
                action: "send_message",
                chatId,
                text: "/mode build",
              },
            }],
          },
        ],
      },
    ],
  }
}

function buildModeSwitchedCard(mode: string): object {
  const label = mode === "plan" ? "📋 Plan（规划）" : "🔨 Build（构建）"
  const desc = mode === "plan" ? "AI 将只分析和规划，不修改文件" : "AI 将直接编写和修改代码"

  return {
    header: {
      title: { tag: "plain_text", content: "✅ 模式已切换" },
      template: "green",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `已切换到 **${label}** 模式\n\n${desc}`,
        },
      },
    ],
  }
}
