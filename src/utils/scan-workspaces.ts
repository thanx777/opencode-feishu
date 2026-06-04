/**
 * 工作区扫描：从配置的 workspaceRoots 列表中读取直接子目录作为可绑定工程。
 *
 * 借鉴自 jazinski/opencode-chat-bridge 的 "Project Switching - Dynamically
 * switch between projects in `~/projects`" 模式，但本仓库实现更轻：
 * - 不调用 opencode Project API（仅 FS 扫描）
 * - 一律只扫直接子目录，深度=1（V1）
 * - 自动跳过 noise 目录（node_modules / .git / dist 等）
 *
 * 注意：本模块不依赖 opencode SDK，可在启动期独立调用。
 */
import { readdirSync, existsSync, statSync } from "node:fs"
import { join, resolve, sep } from "node:path"

/** 默认要排除的目录名（噪声目录、依赖、构建产物）。 */
const DEFAULT_EXCLUDES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".cache",
  ".parcel-cache",
  ".turbo",
  "coverage",
  ".vscode",
  ".idea",
  ".DS_Store",
  "Thumbs.db",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".opencode",
  "node_modules-cache",
])

/** 扫描到的工程条目。 */
export interface ScannedWorkspace {
  /** 显示名：根为 "(root)"，子目录为目录名（大小写保留）。 */
  name: string
  /** 绝对路径（已 resolve）。 */
  path: string
  /** 它所属的 workspaceRoot 绝对路径。 */
  root: string
  /** 是否包含 .git 目录（粗略判断是否是 git 仓库）。 */
  hasGit: boolean
}

export interface ScanWorkspacesOptions {
  /** 自定义排除集合（与默认集合合并）。 */
  excludeDirs?: Iterable<string>
  /** 最大扫描深度，0=只返回根，1=根+直接子目录（默认 1）。 */
  maxDepth?: number
}

/**
 * 扫描所有 workspaceRoots，返回可绑定的工程列表。
 *
 * - 总是把每个 root 自身作为 "(root)" 条目，方便用户绑定到根
 * - 跨 root 重复路径会去重（基于小写化 + 路径分隔符归一化）
 * - 不存在的 root 会静默跳过
 */
export function scanWorkspaces(
  roots: ReadonlyArray<string>,
  options: ScanWorkspacesOptions = {},
): ScannedWorkspace[] {
  const exclude = new Set(DEFAULT_EXCLUDES)
  if (options.excludeDirs) {
    for (const name of options.excludeDirs) exclude.add(name)
  }
  const maxDepth = options.maxDepth ?? 1

  const result: ScannedWorkspace[] = []
  const seenPaths = new Set<string>()

  for (const rawRoot of roots) {
    if (!rawRoot) continue
    const root = resolve(rawRoot)
    if (!existsSync(root)) continue
    let rootStat
    try {
      rootStat = statSync(root)
    } catch {
      continue
    }
    if (!rootStat.isDirectory()) continue

    // 根目录自身：作为 "(root)" 暴露
    const rootKey = normalizePath(root)
    if (!seenPaths.has(rootKey)) {
      seenPaths.add(rootKey)
      result.push({
        name: "(root)",
        path: root,
        root,
        hasGit: hasGitDir(root),
      })
    }

    if (maxDepth <= 0) continue

    let entries: import("node:fs").Dirent[]
    try {
      entries = readdirSync(root, { withFileTypes: true }) as unknown as import("node:fs").Dirent[]
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = String(entry.name)
      // 隐藏目录（如 .vscode）直接跳过——避免和真正项目混淆
      if (name.startsWith(".")) continue
      if (exclude.has(name)) continue

      const fullPath = join(root, name)
      const key = normalizePath(fullPath)
      if (seenPaths.has(key)) continue
      seenPaths.add(key)

      result.push({
        name,
        path: fullPath,
        root,
        hasGit: hasGitDir(fullPath),
      })
    }
  }

  // 排序：根排第一，之后按名字字典序
  result.sort((a, b) => {
    if (a.name === "(root)") return -1
    if (b.name === "(root)") return 1
    if (a.root !== b.root) return a.root.localeCompare(b.root)
    return a.name.localeCompare(b.name)
  })

  return result
}

/** 按显示名查找工程（大小写不敏感）。 */
export function findWorkspaceByName(
  workspaces: ReadonlyArray<ScannedWorkspace>,
  name: string,
): ScannedWorkspace[] {
  const lower = name.toLowerCase()
  return workspaces.filter((w) => w.name.toLowerCase() === lower)
}

function hasGitDir(dir: string): boolean {
  try {
    return statSync(join(dir, ".git")).isDirectory()
  } catch {
    return false
  }
}

/** 跨平台路径归一化：转小写 + 路径分隔符统一为 posix。 */
function normalizePath(p: string): string {
  return p.toLowerCase().split(sep).join("/")
}
