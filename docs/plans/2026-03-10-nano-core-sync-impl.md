# Nano-Core Cross-Instance Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pull 4 changes from cheerful/assistant repos into dev-ops as the nano-core source of truth.

**Architecture:** Cherry-pick individual changes manually (not git cherry-pick — apply diffs by hand) since the source repos have diverged from this codebase. Changes are applied in dependency order: config → Slack fixes → dashboard infrastructure → dashboard integration.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Slack Bolt SDK

---

### Task 1: Bump MAX_CONCURRENT_CONTAINERS default

**Source:** cheerful `09981e3`

**Files:**
- Modify: `src/config.ts:62-65`

**Step 1: Update the default**

In `src/config.ts`, change line 64 from:
```typescript
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
```
to:
```typescript
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '8', 10) || 8,
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation, no errors

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "config: bump MAX_CONCURRENT_CONTAINERS default from 5 to 8"
```

---

### Task 2: Allow file_share messages through Slack event filter

**Source:** cheerful `426f3f9`

**Files:**
- Modify: `src/channels/slack.ts:69-138` (event handler)
- Modify: `src/channels/slack.ts:110-122` (sendMessage trigger detection)

**Step 1: Update the event filter to allow file_share subtype**

In `src/channels/slack.ts`, replace lines 72-81:
```typescript
    this.app.event('message', async ({ event }) => {
      // Bolt's event type is the full MessageEvent union (17+ subtypes).
      // We filter on subtype first, then narrow to the two types we handle.
      const subtype = (event as { subtype?: string }).subtype;
      if (subtype && subtype !== 'bot_message') return;

      // After filtering, event is either GenericMessageEvent or BotMessageEvent
      const msg = event as HandledMessageEvent;

      if (!msg.text) return;
```

with:
```typescript
    this.app.event('message', async ({ event }) => {
      // Bolt's event type is the full MessageEvent union (17+ subtypes).
      // We allow: regular messages (no subtype), bot_message, and file_share
      // (image/file attachments). All other subtypes (channel_join, etc.) are ignored.
      const subtype = (event as { subtype?: string }).subtype;
      const allowedSubtypes = new Set([undefined, 'bot_message', 'file_share']);
      if (!allowedSubtypes.has(subtype)) return;

      // After filtering, event is either GenericMessageEvent or BotMessageEvent
      const msg = event as HandledMessageEvent;

      // For file_share messages, Slack may put the text in a different field
      // or the user may have sent only an image with no text
      const files = (event as { files?: Array<{ name?: string; mimetype?: string; url_private?: string }> }).files;
      if (!msg.text && (!files || files.length === 0)) return;
```

**Step 2: Update the mention detection and content building**

Replace lines 110-137 (from `// Translate Slack <@UBOTID>` to the `this.opts.onMessage` call):
```typescript
      // Translate Slack <@UBOTID> mentions into TRIGGER_PATTERN format.
      // Slack encodes @mentions as <@U12345>, which won't match TRIGGER_PATTERN
      // (e.g., ^@<ASSISTANT_NAME>\b), so we prepend the trigger when the bot is @mentioned.
      let content = msg.text || '';

      // Append file attachment info so the agent knows about shared images/files
      if (files && files.length > 0) {
        const fileDescriptions = files
          .map((f) => `[Attached file: ${f.name || 'unknown'}${f.mimetype ? ` (${f.mimetype})` : ''}${f.url_private ? ` — ${f.url_private}` : ''}]`)
          .join('\n');
        content = content ? `${content}\n${fileDescriptions}` : fileDescriptions;
      }

      if (this.botUserId && !isBotMessage) {
        const mentionPattern = `<@${this.botUserId}>`;
        if (
          content.includes(mentionPattern) &&
          !TRIGGER_PATTERN.test(content)
        ) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Run existing Slack tests**

Run: `npx vitest run src/channels/slack.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/channels/slack.ts
git commit -m "fix: allow file_share messages through Slack event filter"
```

---

### Task 3: Fix scheduled tasks sent to last active thread

**Source:** cheerful `2266fb8`

**Files:**
- Modify: `src/channels/slack.ts:164-182` (sendMessage)
- Modify: `src/index.ts:600-605` (startIpcWatcher sendMessage callback)
- Modify: `src/ipc.ts:13` (IpcDeps interface)
- Modify: `src/ipc.ts:183-184` (IPC thread message sending)

**Step 1: Remove threadTargets fallback from sendMessage**

In `src/channels/slack.ts`, replace line 182:
```typescript
      const thread_ts = threadTs ?? this.threadTargets.get(jid);
```
with:
```typescript
      // Only thread when explicitly requested — no fallback to threadTargets.
      // threadTargets is used for auto-trigger tracking, not for routing outbound messages.
      const thread_ts = threadTs;
```

**Step 2: Update IpcDeps sendMessage signature**

In `src/ipc.ts`, replace line 14:
```typescript
  sendMessage: (jid: string, text: string) => Promise<void>;
```
with:
```typescript
  sendMessage: (jid: string, text: string, threadTs?: string) => Promise<void>;
```

**Step 3: Pass threadTs through in IPC thread message sending**

In `src/ipc.ts`, replace line 184:
```typescript
                        await deps.sendMessage(data.chatJid, data.text);
```
with:
```typescript
                        await deps.sendMessage(data.chatJid, data.text, threadTs);
```

**Step 4: Update the IPC watcher callback in index.ts**

In `src/index.ts`, replace lines 601-604:
```typescript
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
```
with:
```typescript
    sendMessage: (jid, text, threadTs) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text, threadTs);
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 6: Run tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/channels/slack.ts src/ipc.ts src/index.ts
git commit -m "fix: scheduled tasks no longer sent to last active thread"
```

---

### Task 4: Add DASHBOARD_PORT config

**Source:** assistant PR #1

**Files:**
- Modify: `src/config.ts:57-59`

**Step 1: Add DASHBOARD_PORT after CREDENTIAL_PROXY_PORT**

In `src/config.ts`, after line 59 (`);` closing CREDENTIAL_PROXY_PORT), add:
```typescript
export const DASHBOARD_PORT = parseInt(
  process.env.DASHBOARD_PORT || '9090',
  10,
);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "config: add DASHBOARD_PORT setting"
```

---

### Task 5: Add api_usage table and tracking functions to db.ts

**Source:** assistant PR #1

**Files:**
- Modify: `src/db.ts:17-86` (createSchema)
- Modify: `src/db.ts` (add new exports after getAllRegisteredGroups)

**Step 1: Add api_usage table to schema**

In `src/db.ts`, inside `createSchema()`, after the `task_run_logs` index (line 66), add:
```typescript

    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      group_folder TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_api_usage_ts ON api_usage(timestamp);
    CREATE INDEX IF NOT EXISTS idx_api_usage_group ON api_usage(group_folder);
```

**Step 2: Add ApiUsageRecord interface and functions**

After `getAllRegisteredGroups()` (around line 666), add:
```typescript

// --- API usage tracking ---

export interface ApiUsageRecord {
  timestamp: string;
  group_folder: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

/** Expose the database instance for dashboard queries */
export function getDb(): Database.Database {
  return db;
}

export function logApiUsage(record: ApiUsageRecord): void {
  db.prepare(
    `INSERT INTO api_usage (timestamp, group_folder, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.timestamp,
    record.group_folder,
    record.model,
    record.input_tokens,
    record.output_tokens,
    record.cache_creation_tokens,
    record.cache_read_tokens,
    record.cost_usd,
  );
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Commit**

```bash
git add src/db.ts
git commit -m "feat: add api_usage table and tracking functions"
```

---

### Task 6: Add cost tracking to credential proxy (SSE interceptor)

**Source:** assistant PR #1

**Files:**
- Modify: `src/credential-proxy.ts`

**Step 1: Add imports and pricing constants**

At the top of `src/credential-proxy.ts`, add `Transform` import and the pricing/interceptor code. After line 15 (`import { request as httpRequest, RequestOptions } from 'http';`), add:
```typescript
import { Transform } from 'stream';
```

After line 18 (`import { logger } from './logger.js';`), add the import:
```typescript
import { logApiUsage } from './db.js';
```

Then, before the `export type AuthMode` line, add:
```typescript

// Pricing per million tokens (as of 2026-03 for Claude models)
const PRICING: Record<
  string,
  { input: number; output: number; cacheWrite: number; cacheRead: number }
> = {
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  'claude-opus-4-6': {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
  'claude-haiku-4-5': {
    input: 0.8,
    output: 4,
    cacheWrite: 1,
    cacheRead: 0.08,
  },
};

function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number {
  const pricing = model
    ? Object.entries(PRICING).find(([key]) => model.startsWith(key))?.[1]
    : null;

  if (!pricing) return 0;

  return (
    (inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheCreationTokens * pricing.cacheWrite +
      cacheReadTokens * pricing.cacheRead) /
    1_000_000
  );
}

function createSSEInterceptor(groupFolder: string | null): Transform {
  let buffer = '';
  let model: string | null = null;
  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  return new Transform({
    transform(chunk, _encoding, callback) {
      this.push(chunk);

      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === 'message_start' && event.message) {
            model = event.message.model || null;
            const usage = event.message.usage;
            if (usage) {
              inputTokens = usage.input_tokens || 0;
              cacheCreationTokens = usage.cache_creation_input_tokens || 0;
              cacheReadTokens = usage.cache_read_input_tokens || 0;
            }
          }

          if (event.type === 'message_delta' && event.usage) {
            const outputTokens = event.usage.output_tokens || 0;
            const cost = estimateCost(
              model,
              inputTokens,
              outputTokens,
              cacheCreationTokens,
              cacheReadTokens,
            );

            try {
              logApiUsage({
                timestamp: new Date().toISOString(),
                group_folder: groupFolder,
                model,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_creation_tokens: cacheCreationTokens,
                cache_read_tokens: cacheReadTokens,
                cost_usd: cost,
              });
            } catch (err) {
              logger.warn({ err }, 'Failed to log API usage');
            }
          }
        } catch {
          // Not valid JSON, skip
        }
      }

      callback();
    },
  });
}
```

**Step 2: Add group folder extraction and SSE interception to the proxy handler**

In the proxy handler, after the `delete headers['transfer-encoding'];` line (line 63), add:
```typescript

        // Extract group folder from URL path prefix and strip it before forwarding
        let groupFolder: string | null = null;
        let upstreamPath = req.url || '/';

        const proxyMatch = upstreamPath.match(/^\/proxy\/([^/]+)(\/.*)/);
        if (proxyMatch) {
          groupFolder = decodeURIComponent(proxyMatch[1]);
          upstreamPath = proxyMatch[2];
        }
```

Then update the upstream request to use `upstreamPath` instead of `req.url`. Replace:
```typescript
            path: req.url,
```
with:
```typescript
            path: upstreamPath,
```

And add the messages endpoint detection + SSE interception. Before the `const upstream = makeRequest(` line, add:
```typescript
        const isMessagesEndpoint =
          req.method === 'POST' && upstreamPath.endsWith('/v1/messages');
```

Replace the response handler:
```typescript
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
```
with:
```typescript
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            if (isMessagesEndpoint) {
              const interceptor = createSSEInterceptor(groupFolder);
              upRes.pipe(interceptor).pipe(res);
            } else {
              upRes.pipe(res);
            }
          },
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Run credential proxy tests**

Run: `npx vitest run src/credential-proxy.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/credential-proxy.ts
git commit -m "feat: track per-group API usage costs via SSE interceptor"
```

---

### Task 7: Update container-runner to pass groupFolder to proxy URL

**Source:** assistant PR #1

**Files:**
- Modify: `src/container-runner.ts:278-281` (buildContainerArgs signature)
- Modify: `src/container-runner.ts:288-290` (ANTHROPIC_BASE_URL)
- Modify: `src/container-runner.ts:362` (buildContainerArgs call)

**Step 1: Add groupFolder parameter to buildContainerArgs**

In `src/container-runner.ts`, replace line 278-281:
```typescript
function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
): string[] {
```
with:
```typescript
function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  groupFolder: string,
): string[] {
```

**Step 2: Update ANTHROPIC_BASE_URL to include group folder**

Replace lines 288-290:
```typescript
  args.push(
    '-e',
    `ANTHROPIC_BASE_URL=http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`,
  );
```
with:
```typescript
  // The group folder is encoded in the URL path so the proxy can track per-group API usage
  args.push(
    '-e',
    `ANTHROPIC_BASE_URL=http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}/proxy/${encodeURIComponent(groupFolder)}`,
  );
```

**Step 3: Update the call site**

Replace line 362:
```typescript
  const containerArgs = buildContainerArgs(mounts, containerName);
```
with:
```typescript
  const containerArgs = buildContainerArgs(mounts, containerName, group.folder);
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 5: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat: pass group folder to credential proxy for cost tracking"
```

---

### Task 8: Add getActiveGroups to GroupQueue

**Source:** assistant PR #1

**Files:**
- Modify: `src/group-queue.ts` (add method before `shutdown`)

**Step 1: Add getActiveGroups method**

In `src/group-queue.ts`, before the `async shutdown` method (line 352), add:
```typescript

  getActiveGroups(): Array<{
    groupJid: string;
    containerName: string | null;
    groupFolder: string | null;
    isIdle: boolean;
    isTask: boolean;
    runningTaskId: string | null;
  }> {
    const result = [];
    for (const [jid, state] of this.groups) {
      if (state.active) {
        result.push({
          groupJid: jid,
          containerName: state.containerName,
          groupFolder: state.groupFolder,
          isIdle: state.idleWaiting,
          isTask: state.isTaskContainer,
          runningTaskId: state.runningTaskId,
        });
      }
    }
    return result;
  }
```

Note: Check that the GroupState interface has all these fields (`containerName`, `groupFolder`, `idleWaiting`, `isTaskContainer`, `runningTaskId`). If any are missing, the build step will catch it. Some fields may need to be added depending on the current state of the code.

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/group-queue.ts
git commit -m "feat: add getActiveGroups to GroupQueue for dashboard"
```

---

### Task 9: Create dashboard-data.ts

**Source:** assistant PR #1

**Files:**
- Create: `src/dashboard-data.ts`

**Step 1: Create the file**

Create `src/dashboard-data.ts` with the full content from the PR diff. This file contains:
- `getMonthlyCost()` — queries api_usage table for monthly totals
- `getDailyCostByGroup()` — daily breakdown by group folder
- `getActivityFeed()` — union query across messages + task_run_logs
- `getActiveAgents()` — enriches GroupQueue data with group names
- `getTasksWithHistory()` — tasks with last 5 run logs
- `getDashboardData()` — assembles full snapshot
- `writeDashboardSnapshot()` — writes JSON to IPC directory for container to read

The full content is available in the PR diff (356 lines). Copy it exactly from the source.

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/dashboard-data.ts
git commit -m "feat: add dashboard data aggregation module"
```

---

### Task 10: Create dashboard-server.ts

**Source:** assistant PR #1

**Files:**
- Create: `src/dashboard-server.ts`

**Step 1: Create the file**

Create `src/dashboard-server.ts` with the full content from the PR diff. This file provides:
- `startDashboardServer()` — HTTP server on DASHBOARD_PORT
- `stopDashboardServer()` — graceful shutdown
- `createDashboardPage()` — generates a temp HTML page with a random token URL
- `generateDashboardHtml()` — full self-contained HTML dashboard with charts

The full content is available in the PR diff (356 lines). Copy it exactly from the source.

**Important:** The `DASHBOARD_HOST` env var defaults to `5.78.144.214` in the source — this should be updated to match dev-ops infrastructure or made more generic.

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/dashboard-server.ts
git commit -m "feat: add dashboard HTTP server with temp page generation"
```

---

### Task 11: Integrate dashboard into index.ts

**Source:** assistant PR #1

**Files:**
- Modify: `src/index.ts`

**Step 1: Add imports**

At the top of `src/index.ts`, add after the `startCredentialProxy` import:
```typescript
import {
  startDashboardServer,
  stopDashboardServer,
} from './dashboard-server.js';
```

And after the `container-runner.js` imports:
```typescript
import { writeDashboardSnapshot } from './dashboard-data.js';
```

**Step 2: Write dashboard snapshot before running agent**

In the `runAgent` function, after the `writeGroupsSnapshot` call (around line 310-315), add:
```typescript

  // Write dashboard snapshot for container to read
  writeDashboardSnapshot(group.folder, isMain, queue);
```

**Step 3: Start dashboard server in main()**

In the `main()` function, after `startCredentialProxy` (around line 518), add:
```typescript

  // Start dashboard server (serves temp HTML pages)
  await startDashboardServer();
```

**Step 4: Add dashboard shutdown to graceful shutdown handler**

In the shutdown handler, after `proxyServer.close();`, add:
```typescript
    await stopDashboardServer();
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate dashboard server and snapshot writing"
```

---

### Task 12: Add open_dashboard IPC handler and wire getActiveAgents

**Source:** assistant PR #1

**Files:**
- Modify: `src/ipc.ts` (IpcDeps interface + new case)
- Modify: `src/index.ts` (pass getActiveAgents to IPC watcher)

**Step 1: Add getActiveAgents to IpcDeps interface**

In `src/ipc.ts`, add to the `IpcDeps` interface (after `writeGroupsSnapshot`):
```typescript
  getActiveAgents: () => Array<{
    groupJid: string;
    containerName: string | null;
    groupFolder: string | null;
    isIdle: boolean;
    isTask: boolean;
    runningTaskId: string | null;
  }>;
```

**Step 2: Add open_dashboard case to processTaskIpc**

In the `switch (data.type)` block in `processTaskIpc`, before the `default:` case, add:
```typescript

    case 'open_dashboard': {
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized open_dashboard attempt blocked',
        );
        break;
      }

      try {
        const { createDashboardPage } = await import('./dashboard-server.js');
        const { getDashboardData } = await import('./dashboard-data.js');

        const dashData = getDashboardData(deps.getActiveAgents);
        const url = createDashboardPage(dashData);

        // Write URL back to IPC for the container to read
        const responseFile = path.join(
          DATA_DIR,
          'ipc',
          sourceGroup,
          'dashboard_url.txt',
        );
        fs.writeFileSync(responseFile, url);

        logger.info({ url, sourceGroup }, 'Dashboard page created');
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error creating dashboard page');
      }
      break;
    }
```

**Step 3: Wire getActiveAgents in index.ts**

In `src/index.ts`, in the `startIpcWatcher` call, add after the `writeGroupsSnapshot` line:
```typescript
    getActiveAgents: () => queue.getActiveGroups(),
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation

**Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/ipc.ts src/index.ts
git commit -m "feat: add open_dashboard IPC handler"
```

---

### Task 13: Add dashboard MCP tools to container agent-runner

**Source:** assistant PR #1

**Files:**
- Modify: `container/agent-runner/src/ipc-mcp-stdio.ts`

**Step 1: Add dashboard formatting helpers and MCP tools**

After the last `server.tool(...)` call (before the `// Start the stdio transport` comment), add:
- `formatCostData()` — formats cost summary as text
- `formatActivityData()` — formats activity feed as text
- `formatAgentsData()` — formats active agents as text
- `formatTasksData()` — formats task list as text
- `formatSummary()` — formats brief overview
- `query_dashboard` tool — reads `dashboard_snapshot.json` and returns formatted text
- `open_dashboard` tool — writes IPC task file and polls for URL response

The full implementation is available in the PR diff (~210 lines). Copy it exactly from the source.

**Step 2: Rebuild container**

Run: `./container/build.sh`
Expected: Container builds successfully

**Step 3: Commit**

```bash
git add container/agent-runner/src/ipc-mcp-stdio.ts
git commit -m "feat: add query_dashboard and open_dashboard MCP tools"
```

---

### Task 14: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Build**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Rebuild container**

Run: `./container/build.sh`
Expected: Container builds successfully

**Step 4: Smoke test (manual)**

Start the service with `npm run dev` and verify:
1. The dashboard server starts on port 9090 (check logs for "Dashboard server started")
2. Send a test message through Slack — verify the agent responds
3. Check that `data/store/messages.db` has an `api_usage` table with entries after an agent run
