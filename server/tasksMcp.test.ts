import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { McpToolContext, McpToolDef, ServerHost } from "@tabterm/module-host/server";
import activate from "../server.ts";
import { migrations } from "./migrations.ts";
import { makeTasksDb } from "./tasksDb.ts";
import { registerTaskMcpTools } from "./tasksMcp.ts";

const inSession = (sessionId: string): McpToolContext => ({ sessionId, workspaceId: "tab1" });

function freshDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE primary_tabs (id TEXT PRIMARY KEY)");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, label TEXT NOT NULL, primary_tab_id TEXT NOT NULL)");
  db.exec("INSERT INTO primary_tabs VALUES ('tab1')");
  db.exec("INSERT INTO sessions VALUES ('sess1', 'Session', 'tab1')");
  db.exec("INSERT INTO sessions VALUES ('sess2', 'Other session', 'tab1')");
  for (const migration of migrations) migration.up(db);
  return db;
}

function freshMcp() {
  const db = freshDb();
  const definitions: McpToolDef[] = [];
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  const host = {
    registerMcpTool: (definition: McpToolDef) => definitions.push(definition),
    broadcast: (event: string, payload: unknown) => broadcasts.push({ event, payload }),
  } as unknown as ServerHost;
  const tdb = makeTasksDb(db, () => 1_000);
  registerTaskMcpTools(host, tdb);
  const tool = (name: string) => definitions.find((definition) => definition.name === name)!;
  return { broadcasts, db, definitions, tdb, tool };
}

const expectedDefinitions: Array<Pick<McpToolDef, "name" | "inputSchema">> = [
  { name: "tasks_list", inputSchema: { type: "object", properties: {} } },
  {
    name: "tasks_claim",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        agent_id: { type: "string" },
        agent_label: { type: "string" },
      },
      required: ["agent_id", "agent_label"],
    },
  },
  {
    name: "tasks_renew",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" }, lease_token: { type: "string" } },
      required: ["task_id", "lease_token"],
    },
  },
  {
    name: "tasks_ack_comments",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        lease_token: { type: "string" },
        last_seen_comment_id: { type: "string" },
      },
      required: ["task_id", "lease_token"],
    },
  },
  {
    name: "tasks_comment",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        agent_id: { type: "string" },
        agent_label: { type: "string" },
        body_markdown: { type: "string" },
      },
      required: ["task_id", "agent_id", "agent_label", "body_markdown"],
    },
  },
  {
    name: "tasks_release",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        lease_token: { type: "string" },
        body_markdown: { type: "string" },
      },
      required: ["task_id", "lease_token"],
    },
  },
  {
    name: "tasks_complete",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        lease_token: { type: "string" },
        agent_id: { type: "string" },
        summary_markdown: { type: "string" },
      },
      required: ["task_id", "lease_token", "agent_id", "summary_markdown"],
    },
  },
];

test("registers the seven task tools with their exact short names and schemas", () => {
  const { definitions } = freshMcp();
  expect(definitions.map(({ name, inputSchema }) => ({ name, inputSchema })))
    .toEqual(expectedDefinitions);
});

test("every task tool rejects calls outside an open tabterm session", async () => {
  const { definitions } = freshMcp();
  for (const definition of definitions) {
    await expect(Promise.resolve().then(() => definition.handler(
      {},
      { sessionId: null, workspaceId: null },
    ))).rejects.toThrow("not inside an open tabterm session");
  }
});

test("tasks_list derives its scope only from context and returns pretty JSON", async () => {
  const { tdb, tool } = freshMcp();
  tdb.createTask("sess1", { id: "mine", title: "Mine" });
  tdb.createTask("sess2", { id: "theirs", title: "Theirs" });

  const text = await tool("tasks_list").handler(
    { session_id: "sess2" },
    inSession("sess1"),
  );

  expect(text).toBe(JSON.stringify(tdb.getBundle("sess1"), null, 2));
  expect(JSON.parse(text).items.map((item: { id: string }) => item.id)).toEqual(["mine"]);
});

test("mutation tools return DB results and broadcast the changed session bundle", async () => {
  const { broadcasts, tdb, tool } = freshMcp();
  tdb.createTask("sess1", { id: "first", title: "First" });
  tdb.createTask("sess1", { id: "second", title: "Second" });

  const claimed = JSON.parse(await tool("tasks_claim").handler({
    task_id: "first",
    agent_id: "agent-1",
    agent_label: "Agent One",
  }, inSession("sess1")));
  expect(claimed).toMatchObject({ ok: true });
  expect(typeof claimed.value.leaseToken).toBe("string");

  const renewed = JSON.parse(await tool("tasks_renew").handler({
    task_id: "first",
    lease_token: claimed.value.leaseToken,
  }, inSession("sess1")));
  expect(renewed).toMatchObject({ ok: true, value: { taskId: "first", agentId: "agent-1" } });

  const acknowledged = JSON.parse(await tool("tasks_ack_comments").handler({
    task_id: "first",
    lease_token: claimed.value.leaseToken,
  }, inSession("sess1")));
  expect(acknowledged).toMatchObject({ ok: true, value: { lastSeenCommentId: null } });

  const commented = JSON.parse(await tool("tasks_comment").handler({
    task_id: "first",
    agent_id: "agent-1",
    agent_label: "Agent One",
    body_markdown: "Progress",
  }, inSession("sess1")));
  expect(commented).toMatchObject({ ok: true });
  expect(commented.value.bundle.comments[0]).toMatchObject({
    taskId: "first",
    authorType: "agent",
    authorId: "agent-1",
    authorLabel: "Agent One",
    bodyMarkdown: "Progress",
  });

  const released = JSON.parse(await tool("tasks_release").handler({
    task_id: "first",
    lease_token: claimed.value.leaseToken,
    body_markdown: "Pausing",
  }, inSession("sess1")));
  expect(released).toMatchObject({ ok: true });

  const secondClaim = JSON.parse(await tool("tasks_claim").handler({
    task_id: "second",
    agent_id: "agent-1",
    agent_label: "Agent One",
  }, inSession("sess1")));
  const completedText = await tool("tasks_complete").handler({
    task_id: "second",
    lease_token: secondClaim.value.leaseToken,
    agent_id: "agent-1",
    summary_markdown: "Finished",
  }, inSession("sess1"));
  const completed = JSON.parse(completedText);
  expect(completed).toMatchObject({ ok: true });

  expect(broadcasts).toHaveLength(7);
  expect(broadcasts.every(({ event }) => event === "tasks:changed")).toBe(true);
  expect(broadcasts.every(({ payload }) => (
    payload as { list: { sessionId: string } }
  ).list.sessionId === "sess1")).toBe(true);
  expect(completedText).toBe(JSON.stringify(completed, null, 2));
});

test("every targeted mutation rejects a task owned by another session before changing it", async () => {
  const { broadcasts, tdb, tool } = freshMcp();
  tdb.createTask("sess1", { id: "mine", title: "Mine" });
  tdb.createTask("sess2", { id: "theirs", title: "Theirs" });
  const claim = tdb.claimTask("sess2", {
    taskId: "theirs",
    agentId: "agent-2",
    agentLabel: "Agent Two",
  });
  if (!claim.ok) throw new Error("fixture claim failed");

  const attempts = [
    ["tasks_claim", { task_id: "theirs", agent_id: "agent-1", agent_label: "Agent One" }],
    ["tasks_renew", { task_id: "theirs", lease_token: claim.value.leaseToken }],
    ["tasks_ack_comments", { task_id: "theirs", lease_token: claim.value.leaseToken }],
    ["tasks_comment", {
      task_id: "theirs",
      agent_id: "agent-1",
      agent_label: "Agent One",
      body_markdown: "Intrusion",
    }],
    ["tasks_release", { task_id: "theirs", lease_token: claim.value.leaseToken }],
    ["tasks_complete", {
      task_id: "theirs",
      lease_token: claim.value.leaseToken,
      agent_id: "agent-2",
      summary_markdown: "Intrusion",
    }],
  ] as const;

  for (const [name, args] of attempts) {
    const result = JSON.parse(await tool(name).handler(args, inSession("sess1")));
    expect(result).toEqual({ ok: false, code: "not_found", message: "Task not found" });
  }
  expect(broadcasts).toEqual([]);
  expect(tdb.getBundle("sess2")).toMatchObject({
    items: [{ id: "theirs", state: "in_progress" }],
    claims: [{ taskId: "theirs", agentId: "agent-2" }],
    comments: [],
  });
});

test("server activation wires task MCP registration after migrations", () => {
  const db = freshDb();
  const definitions: McpToolDef[] = [];
  const host = {
    dataDir: "/tmp/tabterm-notes-mcp-test",
    db,
    migrate: () => {},
    now: () => 1_000,
    sync: { set: () => ({}), del: () => ({}), toSender: () => ({}) },
    onMessage: () => () => {},
    registerRoute: () => {},
    registerMcpTool: (definition: McpToolDef) => definitions.push(definition),
  } as unknown as ServerHost;

  activate(host);

  expect(definitions.map(({ name }) => name)).toEqual(expectedDefinitions.map(({ name }) => name));
});
