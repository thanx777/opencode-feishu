// 验证 PR2 模块：session-project-cache + pinned-status + notifications 逻辑
import {
  recordSessionDirectory,
  getSessionDirectory,
  resolveSessionDirectory,
} from "../src/handler/session-project-cache.js"
import {
  getPinnedState,
  setPinnedState,
  clearPinnedState,
  listAllPinnedStates,
  buildPinnedText,
  type PinnedState,
} from "../src/handler/pinned-status.js"
import {
  maybeSendBackgroundNotification,
  _resetNotificationThrottle,
} from "../src/handler/notifications.js"
import {
  setChatProject,
  getChatProject,
  clearChatProject,
  listAllChatProjects,
  buildChatKey,
} from "../src/commands/chat-project-map.js"
import type { OpencodeClient } from "@opencode-ai/sdk"
import type * as Lark from "@larksuiteoapi/node-sdk"

console.log("=== TEST 1: session-project-cache ===\n")
recordSessionDirectory("ses_1", "D:\\projects\\backend")
recordSessionDirectory("ses_2", "D:\\projects\\frontend")

if (getSessionDirectory("ses_1") !== "D:\\projects\\backend") {
  console.error("FAIL: ses_1 lookup")
  process.exit(1)
}
if (getSessionDirectory("unknown") !== undefined) {
  console.error("FAIL: unknown lookup should be undefined")
  process.exit(1)
}
console.log("PASS: record + get works\n")

// resolveSessionDirectory: cache miss -> API
const mockClient = {
  session: {
    get: async ({ path }: any) => ({
      data: { id: path.id, directory: `D:\\api\\${path.id}` },
    }),
  },
} as unknown as OpencodeClient
const log = ((_l: string, m: string) => console.log(`[log.${_l}] ${m}`)) as any
const resolved = await resolveSessionDirectory(mockClient, "ses_999", log)
if (resolved !== "D:\\api\\ses_999") {
  console.error("FAIL: API fallback failed")
  process.exit(1)
}
if (getSessionDirectory("ses_999") !== "D:\\api\\ses_999") {
  console.error("FAIL: API result not cached")
  process.exit(1)
}
console.log("PASS: API fallback + cache works\n")

console.log("=== TEST 2: pinned-status state mgmt ===\n")
clearPinnedState("test_chat_1")
setPinnedState("test_chat_1", {
  messageId: "om_test_123",
  status: "running",
  lastSnippet: "test snippet",
  lastActivityAt: Date.now(),
  lastSentAt: Date.now(),
})
const got = getPinnedState("test_chat_1")
if (!got || got.messageId !== "om_test_123" || got.status !== "running") {
  console.error("FAIL: pinned state get")
  process.exit(1)
}
if (listAllPinnedStates().length !== 1) {
  console.error("FAIL: listAllPinnedStates count")
  process.exit(1)
}
console.log("PASS\n")

console.log("=== TEST 3: buildPinnedText ===\n")
const state: PinnedState = {
  messageId: "om_x",
  status: "running",
  lastSnippet: "test snippet content",
  lastActivityAt: new Date("2026-06-04T14:00:00").getTime(),
  lastSentAt: 0,
}
const txt = buildPinnedText("backend", "D:\\projects\\backend", state)
if (!txt.includes("backend")) {
  console.error("FAIL: text missing project name")
  console.error(txt)
  process.exit(1)
}
if (!txt.includes("运行中")) {
  console.error("FAIL: text missing running state")
  process.exit(1)
}
if (!txt.includes("test snippet content")) {
  console.error("FAIL: text missing snippet")
  process.exit(1)
}
console.log("Sample output:")
console.log(txt)
console.log("PASS\n")

console.log("=== TEST 4: pinned-status text message API (mock Lark) ===\n")
_resetNotificationThrottle()
clearChatProject("group", "oc_pin_test")
clearPinnedState("group:oc_pin_test")

let sentMessages: Array<{ receive_id: string; msg_type: string; content: any }> = []
let updatedMessages: Array<{ message_id: string; content: any }> = []
let deletedMessages: string[] = []

const mockLark = {
  im: {
    message: {
      create: async ({ data }: any) => {
        sentMessages.push(data)
        return { code: 0, data: { message_id: `om_${sentMessages.length}` } }
      },
      update: async ({ path, data }: any) => {
        updatedMessages.push({ message_id: path.message_id, content: data.content })
        return { code: 0 }
      },
      delete: async ({ path }: any) => {
        deletedMessages.push(path.message_id)
        return { code: 0 }
      },
    },
  },
} as unknown as InstanceType<typeof Lark.Client>

// Simulate /dir bind -> create pinned
import {
  createPinnedMessage,
  updatePinnedMessage,
  deletePinnedMessage,
} from "../src/handler/pinned-status.js"

setChatProject("group", "oc_pin_test", {
  path: "D:\\projects\\backend",
  name: "backend",
  boundAt: Date.now(),
})

const createdId = await createPinnedMessage(mockLark, "oc_pin_test", "backend", "D:\\projects\\backend", log)
if (!createdId) {
  console.error("FAIL: createPinnedMessage returned undefined")
  process.exit(1)
}
if (sentMessages.length !== 1) {
  console.error("FAIL: expected 1 sent message")
  process.exit(1)
}
console.log(`PASS: created pinned message ${createdId}`)

setPinnedState("group:oc_pin_test", {
  messageId: createdId,
  status: "unknown",
  lastSnippet: "",
  lastActivityAt: Date.now(),
  lastSentAt: 0,
})

// Simulate event -> update pinned
const newState: PinnedState = {
  ...getPinnedState("group:oc_pin_test")!,
  status: "running",
  lastSnippet: "tool: bash",
  lastActivityAt: Date.now(),
  lastSentAt: 0,
}
const r = await updatePinnedMessage(mockLark, "oc_pin_test", createdId, "backend", "D:\\projects\\backend", newState, log)
if (!r.sent) {
  console.error("FAIL: update should have sent")
  process.exit(1)
}
if (updatedMessages.length !== 1) {
  console.error("FAIL: expected 1 updated message")
  process.exit(1)
}
console.log("PASS: pinned status updated on event\n")

// Throttle test
const state2: PinnedState = { ...newState, lastSentAt: Date.now() }
const r2 = await updatePinnedMessage(mockLark, "oc_pin_test", createdId, "backend", "D:\\projects\\backend", state2, log)
if (r2.sent) {
  console.error("FAIL: throttled update should not send")
  process.exit(1)
}
console.log("PASS: throttle works\n")

// Simulate /unbind -> delete pinned
const pinned = getPinnedState("group:oc_pin_test")
if (pinned) {
  await deletePinnedMessage(mockLark, "oc_pin_test", pinned.messageId, log)
  clearPinnedState("group:oc_pin_test")
}
if (deletedMessages.length !== 1) {
  console.error("FAIL: expected 1 deleted message")
  process.exit(1)
}
console.log("PASS: delete pinned on unbind works\n")

console.log("=== TEST 5: background notifications (mock Lark) ===\n")
_resetNotificationThrottle()
sentMessages = []
let notified = await maybeSendBackgroundNotification(
  mockLark, "oc_notify_test", "backend", "ses_abcdef123456",
  "tool: bash 完成", log,
)
if (!notified) {
  console.error("FAIL: first notification should send")
  process.exit(1)
}

// Throttle: 2nd within 5s should not send
notified = await maybeSendBackgroundNotification(
  mockLark, "oc_notify_test", "backend", "ses_abcdef123456",
  "tool: read 完成", log,
)
if (notified) {
  console.error("FAIL: throttled notification should not send")
  process.exit(1)
}
console.log("PASS: notification rate limit works\n")

console.log("=== TEST 6: listAllChatProjects + routing simulation ===\n")
// 先清掉所有可能残留的 bindings (包括 Test 4 的 oc_pin_test)
for (const b of listAllChatProjects()) clearChatProject(b.chatType, b.id)
clearChatProject("group", "oc_a")
clearChatProject("group", "oc_b")
clearChatProject("p2p", "ou_c")

setChatProject("group", "oc_a", { path: "D:\\projects\\backend", name: "backend", boundAt: Date.now() })
setChatProject("group", "oc_b", { path: "D:\\projects\\backend", name: "backend", boundAt: Date.now() })
setChatProject("p2p", "ou_c", { path: "D:\\projects\\frontend", name: "frontend", boundAt: Date.now() })

const all = listAllChatProjects()
if (all.length !== 3) {
  console.error(`FAIL: expected 3 bindings, got ${all.length}`)
  process.exit(1)
}
const backendChats = all.filter(c => c.binding.name === "backend")
if (backendChats.length !== 2) {
  console.error("FAIL: expected 2 chats bound to backend")
  process.exit(1)
}
console.log(`PASS: 3 bindings (2 backend + 1 frontend)\n`)

// Clean up
clearChatProject("group", "oc_a")
clearChatProject("group", "oc_b")
clearChatProject("p2p", "ou_c")

console.log("=== ALL PR2 TESTS PASSED ===")
