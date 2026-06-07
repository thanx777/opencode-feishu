/**
 * `/model` 命令处理
 *
 * 查看和切换 OpenCode 的默认模型。
 * - `/model`       显示当前模型 + 可用模型列表（按钮选择）
 * - `/model <id>`  切换到指定模型（id 格式：providerID/modelID）
 *
 * 实现方式：写入 per-sessionKey 的 model 覆盖，
 * 在 promptAsync 调用时传入 body.model，不依赖 config.update。
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import type { LogFn } from "../types.js"
import { setSessionModelOverride } from "../handler/chat.js"

export interface ModelCommandDeps {
  client: OpencodeClient
  directory: string
  log: LogFn
  chatId: string
  sessionKey: string
}

export interface ModelCommandResult {
  card: object
}

/** 可用模型列表缓存 */
let cachedProviders: Array<{
  providerID: string
  providerName: string
  models: Array<{ modelID: string; name: string; status?: string }>
}> | undefined
let providersCacheExpiry = 0
const PROVIDERS_CACHE_TTL = 60_000

async function getAvailableModels(deps: ModelCommandDeps) {
  const now = Date.now()
  if (cachedProviders && now < providersCacheExpiry) return cachedProviders

  try {
    const { data } = await deps.client.provider.list({ query: { directory: deps.directory } })
    const result: typeof cachedProviders = []

    if (!data) {
      deps.log("warn", "/model: provider.list 返回空 data")
      return []
    }

    deps.log("info", "/model: provider.list 返回", {
      allCount: data.all?.length ?? 0,
      connected: data.connected,
    })

    // 只显示已连接的 provider（有 API key 的）
    const connectedSet = new Set(data.connected ?? [])
    const providers = data.all.filter((p) => connectedSet.has(p.id))

    for (const p of providers) {
      const models = Object.values(p.models || {})
        .filter((m) => m.status !== "deprecated")
        .map((m) => ({
          modelID: m.id,
          name: m.name,
          status: m.status,
        }))
      if (models.length > 0) {
        result.push({
          providerID: p.id,
          providerName: p.name,
          models,
        })
      }
    }

    cachedProviders = result
    providersCacheExpiry = now + PROVIDERS_CACHE_TTL
    return result
  } catch (err) {
    deps.log("error", "/model: provider.list 调用失败", { error: String(err) })
    return []
  }
}

/**
 * 处理 /model 命令
 */
export async function handleModelCommand(
  args: string,
  deps: ModelCommandDeps,
): Promise<ModelCommandResult> {
  const { log, chatId } = deps
  const trimmed = args.trim()

  // /model <providerID/modelID>：切换模型
  if (trimmed && trimmed.includes("/")) {
    return switchModel(trimmed, deps)
  }

  // /model：显示当前模型 + 可用模型列表
  // 优先从 sessionOverrides 读取，否则从 config.get 读取
  let current: string
  const { getSessionOverrides } = await import("../handler/chat.js")
  const overrides = getSessionOverrides(deps.sessionKey)
  if (overrides?.model) {
    current = `${overrides.model.providerID}/${overrides.model.modelID}`
  } else {
    try {
      const { data } = await deps.client.config.get({ query: { directory: deps.directory } })
      current = (data as any)?.model ?? "unknown"
    } catch (err) {
      deps.log("error", "/model: config.get 获取当前模型失败", { error: String(err) })
      current = "unknown"
    }
  }

  const providers = await getAvailableModels(deps)

  log("info", "/model: 显示模型列表", { current, providerCount: providers?.length ?? 0 })

  return {
    card: buildModelCard(current, providers ?? [], chatId),
  }
}

function switchModel(modelId: string, deps: ModelCommandDeps): ModelCommandResult {
  const { log, sessionKey } = deps

  // 解析 providerID/modelID
  const slash = modelId.indexOf("/")
  const providerID = modelId.slice(0, slash)
  const modelID = modelId.slice(slash + 1)

  if (!providerID || !modelID) {
    return {
      card: buildErrorCard("格式错误", `模型 ID 格式应为 \`providerID/modelID\`，收到：\`${modelId}\``),
    }
  }

  setSessionModelOverride(sessionKey, { providerID, modelID })

  log("info", "/model: 切换成功", { model: modelId })

  return {
    card: buildModelSwitchedCard(modelId),
  }
}

function buildModelCard(
  current: string,
  providers: Array<{
    providerID: string
    providerName: string
    models: Array<{ modelID: string; name: string; status?: string }>
  }>,
  chatId: string,
): object {
  const elements: Array<object> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `当前模型：**\`${current}\`**`,
      },
    },
    { tag: "hr" },
  ]

  if (providers.length === 0) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "暂无可用模型。请检查 OpenCode 配置。",
      },
    })
  } else {
    for (const provider of providers) {
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${provider.providerName}** (\`${provider.providerID}\`)`,
        },
      })

      const activeModels = provider.models.slice(0, 8)
      if (activeModels.length === 0) continue

      const columns: Array<object> = []
      for (let i = 0; i < activeModels.length; i += 2) {
        const colSet: Array<object> = []
        for (let j = i; j < Math.min(i + 2, activeModels.length); j++) {
          const m = activeModels[j]
          const fullId = `${provider.providerID}/${m.modelID}`
          const isCurrent = current === fullId
          colSet.push({
            tag: "column",
            width: "weighted",
            weight: 1,
            elements: [{
              tag: "button",
              text: { tag: "plain_text", content: isCurrent ? `✅ ${m.name}` : m.name },
              type: isCurrent ? "primary" : "default",
              disabled: isCurrent,
              value: {
                action: "send_message",
                chatId,
                text: `/model ${fullId}`,
              },
            }],
          })
        }
        columns.push({
          tag: "column_set",
          flex_mode: "none",
          background_style: "default",
          columns: colSet,
        })
      }

      elements.push(...columns)

      const remaining = provider.models.length - 8
      if (remaining > 0) {
        elements.push({
          tag: "div",
          text: {
            tag: "lark_md",
            content: `_...还有 ${remaining} 个模型，发送 \`/model ${provider.providerID}/<modelID>\` 切换_`,
          },
        })
      }

      elements.push({ tag: "hr" })
    }
  }

  elements.push({
    tag: "note",
    elements: [
      {
        tag: "lark_md",
        content: "💡 切换模型后，后续对话将使用新模型。也可直接发送 `/model providerID/modelID` 切换。",
      },
    ],
  })

  return {
    header: {
      title: { tag: "plain_text", content: "🤖 选择模型" },
      template: "purple",
    },
    elements,
  }
}

function buildModelSwitchedCard(modelId: string): object {
  return {
    header: {
      title: { tag: "plain_text", content: "✅ 模型已切换" },
      template: "green",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `已切换到 **\`${modelId}\`**\n\n后续对话将使用此模型。`,
        },
      },
    ],
  }
}

function buildErrorCard(title: string, message: string): object {
  return {
    header: {
      title: { tag: "plain_text", content: `❌ ${title}` },
      template: "red",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: message,
        },
      },
    ],
  }
}
