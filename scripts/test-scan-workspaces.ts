// 验证 scan-workspaces 和 chat-project-map 逻辑
// 使用 tsx 直接跑 TS（不用 dist）
import { scanWorkspaces, findWorkspaceByName } from "../src/utils/scan-workspaces.js"
import { setChatProject, getChatProject, listAllChatProjects, clearChatProject } from "../src/commands/chat-project-map.js"

console.log("=== TEST 1: scan-workspaces ===\n")
const roots = ["D:\\Vibecoding\\Opencode_Project"]
const workspaces = scanWorkspaces(roots)
console.log(`Found ${workspaces.length} workspaces in [${roots.join(", ")}]:`)
for (const w of workspaces) {
  console.log(`  ${w.name.padEnd(20)} ${w.path}  (hasGit=${w.hasGit})`)
}
if (workspaces.length !== 4) {
  console.error(`FAIL: expected 4 (root + backend + frontend + docs), got ${workspaces.length}`)
  process.exit(1)
}
const names = new Set(workspaces.map((w) => w.name))
for (const expected of ["(root)", "backend", "frontend", "docs"]) {
  if (!names.has(expected)) {
    console.error(`FAIL: missing workspace "${expected}"`)
    process.exit(1)
  }
}
console.log("PASS: all 4 expected workspaces found\n")

console.log("=== TEST 2: findWorkspaceByName ===\n")
const backend = findWorkspaceByName(workspaces, "backend")
if (backend.length !== 1 || backend[0].name !== "backend") {
  console.error("FAIL: backend lookup wrong")
  process.exit(1)
}
console.log(`PASS: "backend" → ${backend[0].path}\n`)

const root = findWorkspaceByName(workspaces, "(root)")
if (root.length !== 1 || root[0].name !== "(root)") {
  console.error("FAIL: (root) lookup wrong")
  process.exit(1)
}
console.log(`PASS: "(root)" → ${root[0].path}\n`)

const missing = findWorkspaceByName(workspaces, "nonexistent")
if (missing.length !== 0) {
  console.error("FAIL: nonexistent should return empty")
  process.exit(1)
}
console.log("PASS: nonexistent returns empty\n")

const caseInsensitive = findWorkspaceByName(workspaces, "BACKEND")
if (caseInsensitive.length !== 1) {
  console.error("FAIL: case insensitive lookup broken")
  process.exit(1)
}
console.log("PASS: case-insensitive lookup works\n")

console.log("=== TEST 3: chat-project-map ===\n")
// Clean up any prior state
clearChatProject("group", "oc_test_1")
clearChatProject("p2p", "ou_test_1")

setChatProject("group", "oc_test_1", {
  path: "D:\\Vibecoding\\Opencode_Project\\backend",
  name: "backend",
  boundAt: Date.now(),
})
setChatProject("p2p", "ou_test_1", {
  path: "D:\\Vibecoding\\Opencode_Project\\frontend",
  name: "frontend",
  boundAt: Date.now(),
})

const got1 = getChatProject("group", "oc_test_1")
if (got1?.name !== "backend") {
  console.error("FAIL: group binding not stored")
  process.exit(1)
}
console.log(`PASS: group:oc_test_1 → ${got1.name} (${got1.path})`)

const got2 = getChatProject("p2p", "ou_test_1")
if (got2?.name !== "frontend") {
  console.error("FAIL: p2p binding not stored")
  process.exit(1)
}
console.log(`PASS: p2p:ou_test_1 → ${got2.name} (${got2.path})`)

const all = listAllChatProjects()
if (all.length !== 2) {
  console.error(`FAIL: expected 2 active bindings, got ${all.length}`)
  process.exit(1)
}
console.log(`PASS: listAllChatProjects returns ${all.length} entries`)

clearChatProject("group", "oc_test_1")
if (getChatProject("group", "oc_test_1") !== undefined) {
  console.error("FAIL: clearChatProject did not work")
  process.exit(1)
}
if (listAllChatProjects().length !== 1) {
  console.error("FAIL: after clear, should have 1 binding left")
  process.exit(1)
}
console.log("PASS: clearChatProject works correctly\n")

console.log("=== ALL TESTS PASSED ===")
