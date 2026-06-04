// 端到端测试：handleDirCommand + handleUnbindCommand
import { handleDirCommand, type DirCommandDeps } from "../src/commands/dir.js"
import { handleUnbindCommand } from "../src/commands/unbind.js"
import { getChatProject, clearChatProject } from "../src/commands/chat-project-map.js"
import type { OpencodeClient } from "@opencode-ai/sdk"

const roots = ["D:\\Vibecoding\\Opencode_Project"]
const mockClient = {} as OpencodeClient
const mockLog = ((_lvl: string, msg: string) => console.log(`[log.${_lvl}] ${msg}`)) as any

// Clean state
clearChatProject("group", "oc_e2e_test")

const deps: DirCommandDeps = {
  client: mockClient,
  log: mockLog,
  workspaceRoots: roots,
  chatType: "group",
  chatId: "oc_e2e_test",
}

console.log("=== TEST 1: /dir (unbound) ===\n")
const r1 = await handleDirCommand("", deps)
console.log(`Card template: ${(r1.card as any).header.template}`)
console.log(`Has switchTo: ${!!r1.switchTo}`)
if (!r1.card || r1.switchTo) {
  console.error("FAIL: unbound /dir should show error card, not switch")
  process.exit(1)
}
console.log("PASS\n")

console.log("=== TEST 2: /dir list ===\n")
const r2 = await handleDirCommand("list", deps)
console.log(`Card title: ${(r2.card as any).header.title.content}`)
const cardText2 = JSON.stringify(r2.card)
for (const expected of ["(root)", "backend", "frontend", "docs"]) {
  if (!cardText2.includes(expected)) {
    console.error(`FAIL: card missing "${expected}"`)
    process.exit(1)
  }
}
console.log("PASS: all 4 workspaces appear in /dir list card\n")

console.log("=== TEST 3: /dir backend (bind) ===\n")
const r3 = await handleDirCommand("backend", deps)
console.log(`Card template: ${(r3.card as any).header.template}`)
console.log(`switchTo: ${r3.switchTo?.path}`)
const bound = getChatProject("group", "oc_e2e_test")
if (!bound || bound.name !== "backend") {
  console.error("FAIL: binding not stored")
  process.exit(1)
}
if (!r3.switchTo || r3.switchTo.path !== bound.path) {
  console.error("FAIL: switchTo not returned")
  process.exit(1)
}
console.log("PASS\n")

console.log("=== TEST 4: /dir (bound) ===\n")
const r4 = await handleDirCommand("", deps)
console.log(`Card template: ${(r4.card as any).header.template}`)
const txt = JSON.stringify(r4.card)
if (!txt.includes("backend") || !txt.includes("D:\\\\Vibecoding\\\\Opencode_Project\\\\backend")) {
  console.error("FAIL: current card missing bound info")
  console.error(txt)
  process.exit(1)
}
console.log("PASS\n")

console.log("=== TEST 5: /dir backend (idempotent same-binding) ===\n")
const r5 = await handleDirCommand("backend", deps)
if (r5.switchTo) {
  console.error("FAIL: re-binding to same should not return switchTo")
  process.exit(1)
}
console.log("PASS: no switchTo when re-binding same project\n")

console.log("=== TEST 6: /dir (root) bind ===\n")
const r6 = await handleDirCommand("(root)", deps)
if (!r6.switchTo || !r6.switchTo.path.endsWith("Opencode_Project")) {
  console.error("FAIL: root bind should switch to workspace root")
  process.exit(1)
}
console.log(`PASS: root bound to ${r6.switchTo.path}\n`)

console.log("=== TEST 7: /unbind ===\n")
const r7 = handleUnbindCommand({
  chatType: "group",
  chatId: "oc_e2e_test",
  fallbackDirectory: "D:\\Vibecoding\\Opencode_Project",
  log: mockLog,
})
console.log(`Card template: ${(r7.card as any).header.template}`)
if (!r7.unbind) {
  console.error("FAIL: unbind should set unbind flag")
  process.exit(1)
}
if (getChatProject("group", "oc_e2e_test")) {
  console.error("FAIL: unbind did not clear binding")
  process.exit(1)
}
console.log("PASS\n")

console.log("=== TEST 8: /unbind when not bound ===\n")
const r8 = handleUnbindCommand({
  chatType: "group",
  chatId: "oc_e2e_test",
  fallbackDirectory: "D:\\Vibecoding\\Opencode_Project",
  log: mockLog,
})
if (r8.unbind) {
  console.error("FAIL: unbind on unbound should not set flag")
  process.exit(1)
}
console.log("PASS\n")

console.log("=== TEST 9: /dir unknown name ===\n")
const r9 = await handleDirCommand("nonexistent", deps)
if (r9.switchTo) {
  console.error("FAIL: unknown should not switch")
  process.exit(1)
}
console.log(`Error card template: ${(r9.card as any).header.template}`)
console.log("PASS\n")

console.log("=== ALL E2E TESTS PASSED ===")
