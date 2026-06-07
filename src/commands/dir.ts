/**
 * `/dir` 命令处理
 *
 * 支持的子命令：
 * - `/dir`           显示当前聊天绑定的工程
 * - `/dir list`      列出所有可绑定工程（文件夹浏览器模式）
 * - `/dir browse <path>`  浏览指定路径的子目录
 * - `/dir bind <path>`    按路径直接绑定工程
 * - `/dir <name>`    把此聊天绑定到 <name> 工程
 *
 * 设计要点：
 * - 名称匹配大小写不敏感，基于 basename
 * - 多 root 同名时返回歧义错误，提示使用完整路径（V2 支持）
 * - 切换时返回 switchTo，调用方负责 invalidate session
 * - 借鉴自 M0reee/opencode-feishu 的 `/dir` 命名
 */
import type { OpencodeClient } from "@opencode-ai/sdk"
import type * as Lark from "@larksuiteoapi/node-sdk"
import type { LogFn } from "../types.js"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, resolve, dirname, basename, sep } from "node:path"
import { scanWorkspaces, findWorkspaceByName, type ScannedWorkspace } from "../utils/scan-workspaces.js"
import { buildDirListCard, buildBrowseCard, buildCurrentDirCard, buildErrorCard } from "./cards.js"
import { DIR_HINTS, UNBIND_HINTS, GENERAL_HINTS, mergeHints } from "./command-hints.js"
import { setChatProject, getChatProject, clearChatProject, buildChatKey } from "./chat-project-map.js"
import {
  getPinnedState,
  setPinnedState,
  clearPinnedState,
  createPinnedMessage,
  deletePinnedMessage,
  type PinnedState,
} from "./../handler/pinned-status.js"

export interface DirCommandDeps {
  client: OpencodeClient
  log: LogFn
  workspaceRoots: ReadonlyArray<string>
  chatType: "p2p" | "group"
  chatId: string
  /** PR2: 飞书 client 用于创建/删除 pinned 状态消息 */
  larkClient?: InstanceType<typeof Lark.Client>
}

export interface DirCommandResult {
  card: object
  /** 调用方需要做的副作用（如 invalidate session）。 */
  switchTo?: {
    path: string
    name: string
  }
  /** 调用方需要清空 binding。 */
  unbind?: boolean
}

/**
 * 处理 /dir 命令
 */
export async function handleDirCommand(
  args: string,
  deps: DirCommandDeps,
): Promise<DirCommandResult> {
  const { log, workspaceRoots, chatType, chatId } = deps
  const trimmed = args.trim()
  const sub = trimmed.split(/\s+/)[0] ?? ""

  // /dir -> 显示当前
  if (!sub) {
    return showCurrent(chatType, chatId, log)
  }

  // /dir list -> 列出所有（文件夹浏览器模式）
  if (sub.toLowerCase() === "list") {
    return showList(workspaceRoots, chatId, log)
  }

  // /dir browse <path> -> 浏览指定路径的子目录
  if (sub.toLowerCase() === "browse") {
    const browsePath = trimmed.slice(sub.length).trim()
    return showBrowse(browsePath, workspaceRoots, chatId, log)
  }

  // /dir bind <path> -> 按路径直接绑定
  if (sub.toLowerCase() === "bind") {
    const bindPath = trimmed.slice(sub.length).trim()
    return bindByPath(bindPath, workspaceRoots, chatType, chatId, deps.larkClient, log)
  }

  // /dir <name> -> 绑定
  return bindTo(sub, workspaceRoots, chatType, chatId, deps.larkClient, log)
}

function showCurrent(
  chatType: "p2p" | "group",
  chatId: string,
  log: LogFn,
): DirCommandResult {
  const current = getChatProject(chatType, chatId)
  if (!current) {
    log("info", "/dir: 聊天未绑定工程", { chatType, chatId })
    return {
      card: buildErrorCard(
        "未绑定工程",
        "此聊天还没有绑定到任何工程\n\n**下一步：**\n1. 发送 `/dir list` 查看可用工程\n2. 发送 `/dir <name>` 绑定到 <name>",
      ),
    }
  }
  return {
    card: buildCurrentDirCard(current, mergeHints(DIR_HINTS, UNBIND_HINTS, GENERAL_HINTS)),
  }
}

function showList(workspaceRoots: ReadonlyArray<string>, chatId: string, log: LogFn): DirCommandResult {
  const workspaces = scanWorkspaces(workspaceRoots)
  log("info", "/dir list: 扫描工作区", { count: workspaces.length, roots: workspaceRoots })
  return {
    card: buildDirListCard(workspaces, workspaceRoots, chatId),
  }
}

/** 浏览指定路径的子目录 */
function showBrowse(
  browsePath: string,
  workspaceRoots: ReadonlyArray<string>,
  chatId: string,
  log: LogFn,
): DirCommandResult {
  const resolved = resolve(browsePath)
  if (!existsSync(resolved)) {
    return { card: buildErrorCard("路径不存在", `路径 \`${resolved}\` 不存在。`) }
  }
  let stat
  try { stat = statSync(resolved) } catch {
    return { card: buildErrorCard("无法访问", `无法访问路径 \`${resolved}\`。`) }
  }
  if (!stat.isDirectory()) {
    return { card: buildErrorCard("不是目录", `\`${resolved}\` 不是目录。`) }
  }

  // 读取子目录
  const subdirs: string[] = []
  try {
    const entries = readdirSync(resolved, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = String(entry.name)
      if (name.startsWith(".")) continue
      if (["node_modules", "dist", "build", "out", ".git", ".cache", "coverage", "__pycache__", ".venv", "venv"].includes(name)) continue
      subdirs.push(name)
    }
  } catch {
    return { card: buildErrorCard("无法读取", `无法读取目录 \`${resolved}\`。`) }
  }

  subdirs.sort((a, b) => a.localeCompare(b))

  // 判断是否在 workspaceRoots 内（用于确定"返回"目标）
  const normalizedResolved = normalizePath(resolved)
  const parentRoot = workspaceRoots.find((r) => {
    const nr = normalizePath(r)
    return normalizedResolved === nr || normalizedResolved.startsWith(nr + "/")
  })

  log("info", "/dir browse: 浏览目录", { path: resolved, subdirs: subdirs.length })

  return {
    card: buildBrowseCard(resolved, subdirs, workspaceRoots, chatId),
  }
}

/** 按路径直接绑定工程 */
function bindByPath(
  bindPath: string,
  workspaceRoots: ReadonlyArray<string>,
  chatType: "p2p" | "group",
  chatId: string,
  larkClient: InstanceType<typeof Lark.Client> | undefined,
  log: LogFn,
): DirCommandResult {
  const resolved = resolve(bindPath)
  if (!existsSync(resolved)) {
    return { card: buildErrorCard("路径不存在", `路径 \`${resolved}\` 不存在。`) }
  }

  const name = basename(resolved) || resolved

  const chatKey = buildChatKey(chatType, chatId)
  const previous = getChatProject(chatType, chatId)
  const isSameAsBefore = previous && normalizePath(previous.path) === normalizePath(resolved)
  setChatProject(chatType, chatId, {
    path: resolved,
    name,
    boundAt: Date.now(),
  })

  if (larkClient) {
    void handlePinnedTransition(larkClient, chatType, chatId, chatKey, name, resolved, log)
  }

  log("info", "/dir bind: 按路径绑定成功", {
    chatType, chatId, path: resolved, name, switched: !isSameAsBefore,
  })

  return {
    card: buildCurrentDirCard(
      { path: resolved, name, boundAt: Date.now() },
      mergeHints(DIR_HINTS, UNBIND_HINTS, GENERAL_HINTS),
    ),
    switchTo: isSameAsBefore
      ? undefined
      : { path: resolved, name },
  }
}

function bindTo(
  name: string,
  workspaceRoots: ReadonlyArray<string>,
  chatType: "p2p" | "group",
  chatId: string,
  larkClient: InstanceType<typeof Lark.Client> | undefined,
  log: LogFn,
): DirCommandResult {
  const workspaces = scanWorkspaces(workspaceRoots)
  const matches = findWorkspaceByName(workspaces, name)

  if (matches.length === 0) {
    log("warn", "/dir bind: 找不到工程", { name, available: workspaces.map((w) => w.name) })
    return {
      card: buildErrorCard(
        `工程 "${name}" 不存在`,
        `请检查名称拼写（大小写不敏感）。\n\n发送 \`/dir list\` 查看所有可用工程。`,
      ),
    }
  }

  if (matches.length > 1) {
    const list = matches.map((m, i) => `${i + 1}. \`${m.path}\``).join("\n")
    log("warn", "/dir bind: 多个同名工程", { name, count: matches.length })
    return {
      card: buildErrorCard(
        "存在多个同名工程",
        `工程 "${name}" 在多个根目录下都有。V1 暂不支持消歧。\n\n${list}\n\nV2 将支持按完整路径切换。`,
      ),
    }
  }

  const target = matches[0]

  if (!existsSync(target.path)) {
    log("error", "/dir bind: 路径不存在", { path: target.path })
    return {
      card: buildErrorCard(
        "工程目录不存在",
        `路径不存在：\`${target.path}\`\n\n请确认文件系统状态。`,
      ),
    }
  }

  // 检查是否切换（和当前不同才 invalidate session）
  const chatKey = buildChatKey(chatType, chatId)
  const previous = getChatProject(chatType, chatId)
  const isSameAsBefore = previous && normalizePath(previous.path) === normalizePath(target.path)
  setChatProject(chatType, chatId, {
    path: target.path,
    name: target.name,
    boundAt: Date.now(),
  })

  // PR2: 重建 pinned 状态消息
  // - 如果之前有 pinned（属于其他工程），先删掉
  // - 再为新工程创建一条
  if (larkClient) {
    void handlePinnedTransition(larkClient, chatType, chatId, chatKey, target.name, target.path, log)
  }

  log("info", "/dir bind: 绑定成功", {
    chatType, chatId, target: target.path, name: target.name, switched: !isSameAsBefore,
  })

  return {
    card: buildCurrentDirCard(
      { path: target.path, name: target.name, boundAt: Date.now() },
      mergeHints(DIR_HINTS, UNBIND_HINTS, GENERAL_HINTS),
    ),
    switchTo: isSameAsBefore
      ? undefined
      : { path: target.path, name: target.name },
  }
}

/**
 * PR2: 处理 pinned 状态消息的切换过渡。
 * - 旧 pinned（如果存在）：先删除
 * - 新 pinned：创建
 */
async function handlePinnedTransition(
  larkClient: InstanceType<typeof Lark.Client>,
  chatType: "p2p" | "group",
  chatId: string,
  chatKey: string,
  projectName: string,
  projectPath: string,
  log: LogFn,
): Promise<void> {
  // 删除旧的（如果存在）
  const old = getPinnedState(chatKey)
  if (old) {
    await deletePinnedMessage(larkClient, chatId, old.messageId, log)
    clearPinnedState(chatKey)
  }
  // 创建新的
  const messageId = await createPinnedMessage(larkClient, chatId, projectName, projectPath, log)
  if (messageId) {
    const initial: PinnedState = {
      messageId,
      status: "unknown",
      lastSnippet: "",
      lastActivityAt: Date.now(),
      lastSentAt: 0,
    }
    setPinnedState(chatKey, initial)
  }
}

function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\\/g, "/")
}
