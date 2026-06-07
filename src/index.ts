/**
 * OpenCode 飞书插件入口模块
 *
 * 本文件是 opencode-feishu 插件的主入口，负责：
 * 1. 加载和验证飞书配置（feishu.json + Zod schema）
 * 2. 初始化 Lark SDK 客户端（token 管理、HTTP 调用）
 * 3. 获取 bot 自身 open_id（用于群聊 @提及检测）
 * 4. 启动飞书 WebSocket 长连接网关
 * 5. 注册 OpenCode 事件钩子（SSE 事件处理、tool 注册、最小运行时 prompt 注入）
 * 6. 读取 workspaceRoots 配置（feishu.json），用于 /dir 命令的工程扫描
 * 7. 导出 FeishuPlugin 供 OpenCode 加载
 *
 * 插件不是独立服务——由 OpenCode 管理其生命周期。
 */

// ────────────────── Node.js 内置模块 ──────────────────
import { readFileSync, existsSync } from "node:fs"  // 文件读取和存在性检查（同步版，仅启动阶段使用）
import { join } from "node:path"                     // 跨平台路径拼接
import { fileURLToPath } from "node:url"             // 将 import.meta.url 转为文件系统路径（用于定位 prompts/ 目录）
import { homedir } from "node:os"                    // 获取用户主目录（~/.config/opencode/plugins/feishu.json）

// ────────────────── 飞书 SDK ──────────────────
import * as Lark from "@larksuiteoapi/node-sdk"      // Lark/飞书 SDK：Client（HTTP + token 管理）、WSClient（WebSocket 长连接）

// ────────────────── OpenCode 插件接口 ──────────────────
import type { Plugin, Hooks } from "@opencode-ai/plugin" // Plugin 工厂函数类型 + Hooks 生命周期钩子类型

// ────────────────── Zod 配置校验 ──────────────────
import { z } from "zod"                              // 运行时 schema 验证，启动时捕获配置拼写/类型错误

// ────────────────── 内部模块 ──────────────────
import { FeishuConfigSchema, type ResolvedConfig, type LogFn } from "./types.js"  // 配置 Zod schema + 解析后的配置类型 + 日志函数签名
import { CardKitClient } from "./feishu/cardkit.js"                               // CardKit 2.0 SDK 薄封装（创建/更新/关闭流式卡片）
import { startFeishuGateway, type FeishuGatewayResult } from "./feishu/gateway.js" // 飞书 WebSocket 网关（消息接收、卡片回调、bot 入群事件）
import { enqueueMessage } from "./handler/session-queue.js"                        // 消息队列调度器入口（per-session 并发控制）
import { handleEvent } from "./handler/event.js"                                   // SSE 事件处理器（message.part.updated / permission / question / idle / error）
import { handleCardAction, type InteractiveDeps } from "./handler/interactive.js"  // 交互卡片按钮回调处理（权限审批 / 问答回复）
import { ingestGroupHistory } from "./feishu/history.js"                           // Bot 入群时批量摄入群聊历史消息
import { initDedup } from "./feishu/dedup.js"                                      // 消息去重缓存初始化（默认 10 分钟窗口）
import { createSendCardTool } from "./tools/send-card.js"                          // Agent 可调用的 feishu_send_card tool 工厂
import { createRequestFormTool } from "./tools/request-form.js"                    // 阻塞型 feishu_request_form tool 工厂
import { getChatIdBySession } from "./feishu/session-chat-map.js"                  // 会话 → 聊天 ID 映射查询（判断是否飞书会话）
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"                  // OpenCode v2 REST 客户端（用于权限/问答交互回复）
import { TtlMap } from "./utils/ttl-map.js" // 引入已有的 TtlMap：60s 缓存 config.get() 结果，消除 system.transform 每次触发都调 HTTP 的开销

/** 日志服务标识，所有 client.app.log() 调用都携带此名称 */
const SERVICE_NAME = "opencode-feishu"

/** 日志消息前缀，便于在 OpenCode 日志中快速筛选飞书插件输出 */
const LOG_PREFIX = "[feishu]"

/** 调试模式开关：设置 FEISHU_DEBUG=1 时同时输出结构化 JSON 到 stderr */
const isDebug = !!process.env.FEISHU_DEBUG

/**
 * opencode-otel 等 stderr→OTLP 转发器按「行首英文级别词」映射 Severity；
 * 裸 JSON 会以 UNSPECIFIED 发出，部分 collector 会丢弃或不好检索。
 * @see https://www.npmjs.com/package/opencode-otel — Log Severity Mapping
 */
function otelStderrLinePrefix(level: "info" | "warn" | "error"): string {
  if (level === "error") return "ERROR"
  if (level === "warn") return "WARN"
  return "INFO"
}

/**
 * 从 feishu.json 解析出最终的 workspaceRoots 列表。
 *
 * 优先级：
 * 1. feishu.json 中显式配置的 `workspaceRoots`（校验后已合法）
 * 2. 缺省时回退到 `[resolvedConfig.directory]`
 * 3. 每个 path 必须存在；不存在的会被静默丢弃（带 log.warn）
 *
 * 关键：不读 opencode.jsonc，避免与官方 schema 冲突。
 */
function resolveWorkspaceRoots(resolvedConfig: ResolvedConfig): string[] {
  const configured = resolvedConfig.workspaceRoots
  const candidates = configured && configured.length > 0
    ? configured
    : (resolvedConfig.directory ? [resolvedConfig.directory] : [])

  const result: string[] = []
  for (const r of candidates) {
    if (!r || !r.trim()) continue
    if (!existsSync(r)) {
      // 用一个简易 stderr 输出兜底（log 此处不一定可用）
      console.error(`[feishu] workspaceRoots 路径不存在，已跳过: ${r}`)
      continue
    }
    result.push(r)
  }
  return result
}

/**
 * 发送欢迎卡片到刚加入的群聊。
 *
 * 扫描 workspaceRoots 下的工程列表，直接展示按钮让用户一键选择，
 * 无需输入命令。按钮点击后合成 `/dir <name>` 消息走完整链路。
 */
async function sendWelcomeCard(
  larkClient: InstanceType<typeof Lark.Client>,
  chatId: string,
  workspaceRoots: ReadonlyArray<string>,
  log: LogFn,
): Promise<void> {
  const elements: object[] = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: "你好！我是 opencode 飞书机器人。",
      },
    },
  ]

  if (workspaceRoots.length > 0) {
    elements.push({ tag: "hr" })
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: "**📂 选择工作区根目录：**",
      },
    })
    for (const root of workspaceRoots) {
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
    const rootList = workspaceRoots.length > 0
      ? workspaceRoots.map((r) => `• \`${r}\``).join("\n")
      : "（未配置）"
    elements.push({ tag: "hr" })
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**可用工程根目录：**\n${rootList}`,
      },
    })
  }

  elements.push({ tag: "hr" })
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: "**其他命令：**\n• `/dir list` - 查看所有工程\n• `/dir` - 查看当前绑定\n• `/unbind` - 解除绑定\n• `/new` - 在当前工程创建新会话\n• `/history` - 查看历史会话",
    },
  })

  const card = {
    header: {
      title: { tag: "plain_text", content: "👋 opencode 飞书机器人" },
      template: "blue",
    },
    elements,
  }
  const res = await larkClient.im.message.create({
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
    params: { receive_id_type: "chat_id" },
  })
  if (res.code !== 0) {
    log("warn", "欢迎卡片返回非 0", { chatId, code: res.code, msg: res.msg })
  }
}

/**
 * 从 prompts/ 目录加载飞书运行时 prompt（system prompt 片段）。
 *
 * 这里只注入飞书渠道事实和工具契约，不注入任何会塑形 agent 输出策略的维护文档。
 * 内容在插件启动时读取一次，修改后重启即生效（无需重新构建）。
 *
 * @returns 飞书运行时 prompt 字符串；prompt 文件缺失时直接抛错阻止启动
 */
function loadFeishuRuntimePrompt(): string {
  // 基于当前模块路径回溯到项目根目录下的 prompts/ 文件夹
  const promptPath = join(fileURLToPath(import.meta.url), "../../prompts/feishu-card-interaction/prompt.md")
  return readFileSync(promptPath, "utf-8")
}

/** 缓存的飞书运行时 prompt，在模块加载时一次性读取 */
const feishuRuntimePrompt = loadFeishuRuntimePrompt()

/**
 * OpenCode 插件入口导出。
 *
 * OpenCode 在加载插件时会调用这个工厂函数，
 * 它完成初始化后返回本插件注册的 hooks 集合。
 */
export const FeishuPlugin: Plugin = async (ctx) => {
  const { client } = ctx
  // `gateway` 用于在各个 hook 闭包里判断网关是否已经成功初始化。
  let gateway: FeishuGatewayResult | null = null

  // 60s 缓存 config.get() 结果（model 只在用户手动切换模型时才变化，缓存基本等价于实时）
  const configCache = new TtlMap<{ model?: string }>(60_000)
  const CONFIG_CACHE_KEY = "global"

  // 统一日志桥接：始终写入 OpenCode 日志；调试模式额外输出 stderr JSON。
  const log: LogFn = (level, message, extra) => {
    const prefixed = `${LOG_PREFIX} ${message}`
    if (isDebug) {
      const payload = JSON.stringify({ ts: new Date().toISOString(), service: SERVICE_NAME, level, message: prefixed, ...extra })
      // 行首级别词 + 空格 + JSON，便于 opencode-otel 映射为 INFO/WARN/ERROR
      console.error(`${otelStderrLinePrefix(level)} ${payload}`)
    }
    client.app.log({
      body: {
        service: SERVICE_NAME,
        level,
        message: prefixed,
        extra,
      },
    }).catch(() => {})
  }

  // 优先使用项目内的 feishu.local.json，方便直接编辑；
  // 如果不存在则回退到 ~/.config/opencode/plugins/feishu.json
  const pluginDir = join(fileURLToPath(import.meta.url), "../..")
  const localConfigPath = join(pluginDir, "feishu.local.json")
  const globalConfigPath = join(homedir(), ".config", "opencode", "plugins", "feishu.json")
  const configPath = existsSync(localConfigPath) ? localConfigPath : globalConfigPath
  let resolvedConfig: ResolvedConfig
  try {
    // 启动期一次性完成配置读取、环境变量展开和 schema 校验。
    resolvedConfig = loadAndValidateConfig(configPath, ctx.directory ?? "")
    log("info", `配置加载自: ${configPath}`)
  } catch (e) {
    if (e instanceof z.ZodError) {
      const details = e.issues.map(i => `  - ${i.path.join(".")}: ${i.message}`).join("\n")
      throw new Error(`${LOG_PREFIX} 配置验证失败:\n${details}`)
    }
    if (e instanceof SyntaxError) {
      throw new Error(`飞书配置文件格式错误：${configPath} 必须是合法的 JSON (${e.message})`)
    }
    throw e
  }

  // 初始化去重缓存
  initDedup(resolvedConfig.dedupTtl)

  // 创建 Lark Client（SDK 内置 token 管理 + HTTP 客户端）
  const larkClient = new Lark.Client({
    appId: resolvedConfig.appId,
    appSecret: resolvedConfig.appSecret,
    domain: Lark.Domain.Feishu,
    appType: Lark.AppType.SelfBuild,
  })
  const cardkit = new CardKitClient(larkClient, log)

  // 获取 bot open_id（用于群聊 @提及检测）
  const botOpenId = await fetchBotOpenId(larkClient, log)

  // opencode server Basic Auth: 如果用户配置了 serverPassword, 给所有客户端加 Authorization header
  const serverAuthHeader = buildOpencodeServerAuthHeader(resolvedConfig, log)

  // v2 client 主要用于权限审批/问答交互回调。
  const v2Client = createOpencodeClient({
    directory: resolvedConfig.directory || undefined,
    headers: serverAuthHeader ? { Authorization: serverAuthHeader } : {},
  })
  const interactiveDeps: InteractiveDeps = { feishuClient: larkClient, log, v2Client }

  // ctx.client (in-process 客户端) 也需要 Auth —— 用 interceptor 注入
  // OpencodeClient 类未公开 interceptors 字段, 但底层 Client 类型有
  if (serverAuthHeader) {
    const rawClient = client as unknown as {
      interceptors?: {
        request?: { use: (fn: (req: Request) => Promise<Request> | Request) => unknown }
      }
    }
    if (rawClient.interceptors?.request?.use) {
      rawClient.interceptors.request.use(async (request) => {
        request.headers.set("Authorization", serverAuthHeader)
        return request
      })
      log("info", "已为 ctx.client 注入 opencode server Auth header")
    } else {
      log("warn", "ctx.client 不支持 interceptors, 跳过 Auth 注入 (可能不需要)")
    }
  }

  // 启动飞书 WebSocket 网关（复用 larkClient）
  // workspaceRoots 从 feishu.json 读取，缺失时回退到 [resolvedConfig.directory]
  const workspaceRoots = resolveWorkspaceRoots(resolvedConfig)
  log("info", "workspaceRoots 已加载", { count: workspaceRoots.length, roots: workspaceRoots })

  gateway = startFeishuGateway({
    config: resolvedConfig,
    larkClient,
    botOpenId,
    onMessage: async (msgCtx) => {
      // 网关未完成初始化或消息为空时，不进入主处理链路。
      if (!msgCtx.content.trim() || !gateway) return
      await enqueueMessage(msgCtx, {
        config: resolvedConfig,
        client,
        feishuClient: larkClient,
        log,
        directory: resolvedConfig.directory,
        cardkit,
        interactiveDeps,
        v2Client,
        workspaceRoots,
        larkClient,
      })
    },
    onBotAdded: (chatId) => {
      if (!gateway) return
      // Bot 刚入群时：异步补录历史消息 + 主动发送欢迎卡片
      ingestGroupHistory(larkClient, client, chatId, {
        maxMessages: resolvedConfig.maxHistoryMessages,
        log,
        directory: resolvedConfig.directory,
      }).catch((err) => {
        log("error", "群聊历史摄入失败", {
          chatId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      // 发送欢迎消息：引导用户 /dir 绑定工程
      sendWelcomeCard(larkClient, chatId, workspaceRoots, log).catch((err) => {
        log("error", "发送欢迎消息失败", {
          chatId,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    },
    onCardAction: async (action) => {
      if (!gateway) return
      // 交互按钮统一交给 interactive 层处理。
      return handleCardAction(action, interactiveDeps)
    },
    log,
  })

  log("info", "飞书插件已初始化", {
    appId: resolvedConfig.appId.slice(0, 8) + "...",
    botOpenId,
  })

  const hooks: Hooks = {
    event: async ({ event }) => {
      // 只有网关可用时才消费 OpenCode SSE 事件。
      if (!gateway) return
      await handleEvent(event, {
        log,
        directory: resolvedConfig.directory,
        client,
        nudge: resolvedConfig.nudge,
        larkClient, // PR2: 全局事件路由需要
      })
    },
    tool: {
      feishu_send_card: createSendCardTool({ feishuClient: larkClient, log }),
      feishu_request_form: createRequestFormTool({ feishuClient: larkClient, log }),
    },
    "experimental.chat.system.transform": async (input, output) => {
      // 仅在飞书会话中注入最小运行时 prompt，非飞书会话不干扰 agent
      if (!input.sessionID || !getChatIdBySession(input.sessionID)) return
      output.system.push(feishuRuntimePrompt)

      // 注入运行时上下文（工作目录 + 当前模型）
      const runtimeLines = [`当前工作目录: ${resolvedConfig.directory || ctx.directory || "未设置"}`]
      try {
        // 先查缓存；缓存命中则跳过 HTTP 调用（60s 内有效）
        let cached = configCache.get(CONFIG_CACHE_KEY)
        if (!cached) {
          // 缓存未命中，调一次 HTTP 并写入缓存
          const cfg = await client.config.get({ query: { directory: resolvedConfig.directory || undefined } })
          cached = { model: cfg?.data?.model }
          configCache.set(CONFIG_CACHE_KEY, cached)
        }
        if (cached.model) runtimeLines.push(`当前模型: ${cached.model}`)
      } catch (err) {
        log("warn", "获取 config 失败", { error: err instanceof Error ? err.message : String(err) })
      }
      // 作为独立 system 段落注入，避免和 skill 文本粘连。
      output.system.push(runtimeLines.join("\n"))
    },

    // chat.message：每条消息进入 agent 前记录结构化日志（sessionId/agent/model），便于飞书侧排查问题
    // 仅在飞书会话中生效；非飞书渠道直接 return 不影响其他插件
    "chat.message": async (input, _output) => {
      if (!gateway) return
      const { sessionID, agent, model } = input
      if (!sessionID || !getChatIdBySession(sessionID)) return
      log("info", "chat.message 到达", {
        sessionId: sessionID,
        agent: agent ?? "default",
        model: model ? `${model.providerID}/${model.modelID}` : "unknown",
      })
    },

    // permission.ask：飞书会话中自动放行 read 权限（用户已通过飞书认证，读文件风险低）
    // write/execute 等高危权限保持默认 ask 行为，交互卡片正常弹出
    // input 类型为 Plugin SDK Permission，不含 sessionID，通过 as any 安全提取（SDK 类型定义限制）
    "permission.ask": async (input, output) => {
      if (!gateway) return
      const sessionID = (input as any).sessionID as string | undefined
      if (!sessionID || !getChatIdBySession(sessionID)) return
      const permission = (input as any).permission as string | undefined
      if (permission === "read") {
        output.status = "allow"
        log("info", "飞书会话自动授权 read 权限", { sessionId: sessionID })
      }
    },

    // tool.execute.after：工具执行完成后记录日志（tool 名/sessionId/callID），飞书侧可据此排查工具调用问题
    // 仅在飞书会话中生效；其他渠道早期 return
    "tool.execute.after": async (input, _output) => {
      if (!gateway) return
      const { tool, sessionID } = input
      if (!sessionID || !getChatIdBySession(sessionID)) return
      log("info", "工具执行完成", {
        tool,
        sessionId: sessionID,
        callID: input.callID,
      })
    },
  }
  return hooks
}

/**
 * 构造 opencode server HTTP Basic Auth header 字符串。
 * 如果用户没配 serverPassword, 返回 undefined (不发送 Auth, 适用于 127.0.0.1 本机访问)。
 * 注意: feishu.json 里的 serverPassword 必须和 start-serve.bat 中 OPENCODE_SERVER_PASSWORD 保持一致。
 */
function buildOpencodeServerAuthHeader(
  config: ResolvedConfig,
  log: LogFn,
): string | undefined {
  if (!config.serverPassword) return undefined
  const username = config.serverUsername ?? "opencode"
  const token = Buffer.from(`${username}:${config.serverPassword}`).toString("base64")
  log("info", "opencode server Basic Auth 已启用", { username })
  return `Basic ${token}`
}

/**
 * 从配置文件读取、解析环境变量占位符、Zod 验证、展开 directory 路径。
 * 抛出 ZodError / SyntaxError / Error（文件不存在）。
 */
function loadAndValidateConfig(configPath: string, ctxDirectory: string): ResolvedConfig {
  if (!existsSync(configPath)) {
    throw new Error(`缺少飞书配置文件：请创建 ${configPath}，内容为 {"appId":"cli_xxx","appSecret":"xxx"}`)
  }
  // 先 JSON.parse，再递归展开字符串里的环境变量占位符。
  const raw = resolveEnvPlaceholders(JSON.parse(readFileSync(configPath, "utf-8")))
  const parsed = FeishuConfigSchema.parse(raw)
  // directory 在这里统一展开成最终运行时路径。
  return { ...parsed, directory: expandDirectoryPath(parsed.directory ?? ctxDirectory ?? "") }
}

/**
 * 展开 directory 路径中的环境变量和 ~ 前缀。
 * 支持 ${VAR} 和 ~ 两种语法。
 */
function expandDirectoryPath(dir: string): string {
  if (!dir) return dir
  // 展开 ~ 为用户主目录
  if (dir.startsWith("~")) {
    dir = join(homedir(), dir.slice(1))
  }
  // 展开 ${VAR} 环境变量（不支持 $VAR 无花括号语法，避免与路径中 $ 字符歧义）
  dir = dir.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
    const val = process.env[name]
    if (val === undefined) {
      throw new Error(`环境变量 ${name} 未设置（directory 引用了 \${${name}}）`)
    }
    return val
  })
  return dir
}

/**
 * 递归替换对象中字符串值里的 ${ENV_VAR} 占位符。
 * 明文值原样保留，仅替换包含 ${...} 的字符串。
 * 环境变量未设置时抛出错误，防止静默使用空值。
 */
function resolveEnvPlaceholders(obj: unknown): unknown {
  if (typeof obj === "string") {
    if (!obj.includes("${")) return obj
    return obj.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
      const val = process.env[name]
      if (val === undefined) {
        throw new Error(`环境变量 ${name} 未设置（配置值引用了 \${${name}}）`)
      }
      return val
    })
  }
  if (Array.isArray(obj)) {
    // 数组元素递归替换，占位符规则与对象字段一致。
    return obj.map(resolveEnvPlaceholders)
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // 对象值逐个递归替换，键名保持原样。
      result[key] = resolveEnvPlaceholders(value)
    }
    return result
  }
  return obj
}

/**
 * 获取 bot 自身的 open_id（用于群聊 @提及检测）
 * 使用 Lark SDK client.request() 自动处理认证
 * 失败时直接抛出错误，阻止插件启动
 */
async function fetchBotOpenId(
  larkClient: InstanceType<typeof Lark.Client>,
  log: LogFn,
): Promise<string> {
  // SDK 没有 /bot/v3/info 的语义方法，因此走通用 request()。
  const res = await larkClient.request<{ bot?: { open_id?: string } }>({
    url: "https://open.feishu.cn/open-apis/bot/v3/info",
    method: "GET",
  })
  const openId = res?.bot?.open_id
  if (!openId) {
    throw new Error("Bot open_id 为空，无法启动群聊 @提及检测")
  }
  log("info", "Bot open_id 获取成功", { openId })
  return openId
}
