# Concurrent Thread Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable multiple independent agent sessions within a single Slack channel, where each `@Cheerful` thread gets its own container running concurrently — no blocking, no session switching.

**Architecture:** Replace the current 1:1 `chatJid → container` mapping with `sessionKey → container`, where `sessionKey = {chatJid}::{thread_ts}` for threaded sessions and just `{chatJid}` for non-threaded channels. Each thread session gets isolated filesystem and IPC directories while sharing the group's read-only knowledge. The GroupQueue, message loop, and container mounts are updated to use sessionKeys. Non-Slack channels are unaffected.

**Tech Stack:** TypeScript, SQLite, Vitest, Docker containers, Claude Agent SDK

**Prior Work:** Thread metadata (`thread_ts`) already flows from Slack → DB → IPC → agent-runner (see `2026-03-09-per-thread-sessions.md`). This plan builds on that foundation to make threads truly concurrent rather than sequential/switching.

---

### Task 1: Session key helpers

**Files:**
- Create: `src/session-key.ts`
- Create: `src/session-key.test.ts`

**Step 1: Write the failing test**

Create `src/session-key.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSessionKey, parseSessionKey } from './session-key.js';

describe('session key helpers', () => {
  describe('buildSessionKey', () => {
    it('returns chatJid::threadTs for threaded sessions', () => {
      expect(buildSessionKey('slack:C123', '1234567890.123456'))
        .toBe('slack:C123::1234567890.123456');
    });

    it('returns chatJid alone when threadTs is undefined', () => {
      expect(buildSessionKey('slack:C123', undefined)).toBe('slack:C123');
    });

    it('returns chatJid alone for non-Slack channels', () => {
      expect(buildSessionKey('12345@g.us', undefined)).toBe('12345@g.us');
    });
  });

  describe('parseSessionKey', () => {
    it('parses threaded session key', () => {
      const result = parseSessionKey('slack:C123::1234567890.123456');
      expect(result).toEqual({
        chatJid: 'slack:C123',
        threadTs: '1234567890.123456',
      });
    });

    it('parses non-threaded session key', () => {
      const result = parseSessionKey('slack:C123');
      expect(result).toEqual({
        chatJid: 'slack:C123',
        threadTs: undefined,
      });
    });

    it('parses non-Slack JIDs', () => {
      const result = parseSessionKey('12345@g.us');
      expect(result).toEqual({
        chatJid: '12345@g.us',
        threadTs: undefined,
      });
    });

    it('roundtrips with buildSessionKey', () => {
      const key = buildSessionKey('slack:C123', '1234.5678');
      const parsed = parseSessionKey(key);
      expect(parsed.chatJid).toBe('slack:C123');
      expect(parsed.threadTs).toBe('1234.5678');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/session-key.test.ts`
Expected: FAIL — module not found

**Step 3: Implement session key helpers**

Create `src/session-key.ts`:

```typescript
const SESSION_KEY_SEPARATOR = '::';

export function buildSessionKey(chatJid: string, threadTs?: string): string {
  if (threadTs) return `${chatJid}${SESSION_KEY_SEPARATOR}${threadTs}`;
  return chatJid;
}

export function parseSessionKey(sessionKey: string): {
  chatJid: string;
  threadTs: string | undefined;
} {
  const idx = sessionKey.indexOf(SESSION_KEY_SEPARATOR);
  if (idx === -1) return { chatJid: sessionKey, threadTs: undefined };
  return {
    chatJid: sessionKey.slice(0, idx),
    threadTs: sessionKey.slice(idx + SESSION_KEY_SEPARATOR.length),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/session-key.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/session-key.ts src/session-key.test.ts
git commit -m "feat: add session key helpers for concurrent thread sessions"
```

---

### Task 2: Thread-scoped message queries

**Files:**
- Modify: `src/db.ts:343-398` (getNewMessages and getMessagesSince)
- Modify: `src/db.test.ts` (add thread filter tests)

Thread-scoped queries let the orchestrator gather context for just one thread instead of the entire channel.

**Step 1: Write the failing test**

Add to `src/db.test.ts` (or create `src/db-thread-filter.test.ts` if cleaner):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, storeMessage, getMessagesSince, getNewMessages } from './db.js';

describe('thread-scoped message queries', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('getMessagesSince filters by threadTs when provided', () => {
    storeMessage({
      id: 'msg1', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: 'thread A msg',
      timestamp: '2026-03-09T00:00:01Z', thread_ts: '1111.0000',
    });
    storeMessage({
      id: 'msg2', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: 'thread B msg',
      timestamp: '2026-03-09T00:00:02Z', thread_ts: '2222.0000',
    });
    storeMessage({
      id: 'msg3', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: 'top-level msg',
      timestamp: '2026-03-09T00:00:03Z',
    });

    const threadA = getMessagesSince('slack:C123', '', 'Bot', '1111.0000');
    expect(threadA).toHaveLength(1);
    expect(threadA[0].content).toBe('thread A msg');

    const threadB = getMessagesSince('slack:C123', '', 'Bot', '2222.0000');
    expect(threadB).toHaveLength(1);
    expect(threadB[0].content).toBe('thread B msg');

    // Without threadTs filter, returns all messages (backward compat)
    const all = getMessagesSince('slack:C123', '', 'Bot');
    expect(all).toHaveLength(3);
  });

  it('getNewMessages includes thread_ts in returned messages', () => {
    storeMessage({
      id: 'msg1', chat_jid: 'slack:C123', sender: 'U001',
      sender_name: 'alice', content: '@Bot hello',
      timestamp: '2026-03-09T00:00:01Z', thread_ts: '1111.0000',
    });

    const { messages } = getNewMessages(['slack:C123'], '', 'Bot');
    expect(messages).toHaveLength(1);
    expect(messages[0].thread_ts).toBe('1111.0000');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db-thread-filter.test.ts`
Expected: FAIL — `getMessagesSince` doesn't accept 4th arg, `getNewMessages` doesn't return `thread_ts`

**Step 3: Update getMessagesSince to accept optional threadTs filter**

In `src/db.ts`, update `getMessagesSince` (around line 374):

```typescript
export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
  threadTs?: string,
): NewMessage[] {
  const threadFilter = threadTs !== undefined ? ' AND thread_ts = ?' : '';
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, thread_ts
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL${threadFilter}
    ORDER BY timestamp
  `;
  const params: (string | number)[] = [chatJid, sinceTimestamp, `${botPrefix}:%`];
  if (threadTs !== undefined) params.push(threadTs);

  const rows = db
    .prepare(sql)
    .all(...params) as Array<NewMessage & { thread_ts: string | null }>;
  return rows.map((row) => ({
    ...row,
    thread_ts: row.thread_ts || undefined,
  }));
}
```

**Step 4: Update getNewMessages to include thread_ts**

In `src/db.ts`, update `getNewMessages` (around line 343):

Change the SELECT to include `thread_ts`:

```sql
SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, thread_ts
FROM messages
WHERE timestamp > ? AND chat_jid IN (${placeholders})
  AND is_bot_message = 0 AND content NOT LIKE ?
  AND content != '' AND content IS NOT NULL
ORDER BY timestamp
```

And update the return mapping to convert null thread_ts to undefined:

```typescript
const rows = db
  .prepare(sql)
  .all(lastTimestamp, ...jids, `${botPrefix}:%`) as Array<
  NewMessage & { thread_ts: string | null }
>;

const messages = rows.map((row) => ({
  ...row,
  thread_ts: row.thread_ts || undefined,
}));

let newTimestamp = lastTimestamp;
for (const row of messages) {
  if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
}

return { messages, newTimestamp };
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/db-thread-filter.test.ts`
Expected: PASS

**Step 6: Run full test suite for regressions**

Run: `npx vitest run`
Expected: All pass

**Step 7: Commit**

```bash
git add src/db.ts src/db-thread-filter.test.ts
git commit -m "feat: thread-scoped message queries for concurrent sessions"
```

---

### Task 3: Expand Channel.sendMessage with threadTs parameter

**Files:**
- Modify: `src/types.ts:89` (Channel interface)
- Modify: `src/channels/slack.ts:233-273` (sendMessage)
- Modify: `src/channels/slack.test.ts` (add threadTs test)
- Modify: `src/channels/whatsapp.ts:258` (accept and ignore param)
- Modify: `src/router.ts:94-102` (routeOutbound — if used)

**Step 1: Write the failing test**

Add to `src/channels/slack.test.ts` in the `sendMessage` describe block:

```typescript
it('uses explicitly passed threadTs over internal threadTargets', async () => {
  const opts = createTestOpts({
    registeredGroups: vi.fn(() => ({
      'slack:C0123456789': {
        name: 'Test Channel',
        folder: 'test-channel',
        trigger: '@Jonesy',
        added_at: '2024-01-01T00:00:00.000Z',
        requiresTrigger: true,
      },
    })),
  });
  const channel = new SlackChannel(opts);
  await channel.connect();

  // Trigger an @mention that sets threadTargets to '1111.0000'
  const event = createMessageEvent({
    text: 'Hey <@U_BOT_123> help',
    ts: '1111.0000',
    user: 'U_USER_456',
  });
  await triggerMessageEvent(event);

  // Send with explicit threadTs — should use the explicit value, not '1111.0000'
  await channel.sendMessage('slack:C0123456789', 'Reply', '2222.0000');

  expect(currentApp().client.chat.postMessage).toHaveBeenCalledWith({
    channel: 'C0123456789',
    text: 'Reply',
    thread_ts: '2222.0000',
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/channels/slack.test.ts -t "uses explicitly passed threadTs"`
Expected: FAIL — sendMessage doesn't accept 3rd arg / still uses threadTargets

**Step 3: Update Channel interface**

In `src/types.ts:89`, change:

```typescript
sendMessage(jid: string, text: string, threadTs?: string): Promise<void>;
```

**Step 4: Update SlackChannel.sendMessage**

In `src/channels/slack.ts`, update `sendMessage` (line 233):

```typescript
async sendMessage(jid: string, text: string, threadTs?: string): Promise<void> {
  const channelId = jid.replace(/^slack:/, '');

  if (!this.connected) {
    this.outgoingQueue.push({ jid, text });
    logger.info(
      { jid, queueSize: this.outgoingQueue.length },
      'Slack disconnected, message queued',
    );
    return;
  }

  try {
    // Use explicitly passed threadTs (concurrent sessions), fall back to tracked target
    const thread_ts = threadTs ?? this.threadTargets.get(jid);

    // Slack limits messages to ~4000 characters; split if needed
    if (text.length <= MAX_MESSAGE_LENGTH) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text,
        thread_ts,
      });
    } else {
      for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: text.slice(i, i + MAX_MESSAGE_LENGTH),
          thread_ts,
        });
      }
    }
    logger.info({ jid, length: text.length, threaded: !!thread_ts }, 'Slack message sent');
  } catch (err) {
    this.outgoingQueue.push({ jid, text });
    logger.warn(
      { jid, err, queueSize: this.outgoingQueue.length },
      'Failed to send Slack message, queued',
    );
  }
}
```

**Step 5: Update WhatsApp channel (if present)**

In `src/channels/whatsapp.ts:258`, add the parameter (ignored):

```typescript
async sendMessage(jid: string, text: string, _threadTs?: string): Promise<void> {
```

**Step 6: Run test to verify it passes**

Run: `npx vitest run src/channels/slack.test.ts -t "uses explicitly passed threadTs"`
Expected: PASS

**Step 7: Run full Slack test suite**

Run: `npx vitest run src/channels/slack.test.ts`
Expected: All pass (existing tests still work — threadTs is optional)

**Step 8: Commit**

```bash
git add src/types.ts src/channels/slack.ts src/channels/whatsapp.ts
git commit -m "feat: add threadTs parameter to Channel.sendMessage"
```

---

### Task 4: Container-runner thread-scoped mounts

**Files:**
- Modify: `src/container-runner.ts:35-45` (ContainerInput — add threadTs)
- Modify: `src/container-runner.ts:81-261` (buildVolumeMounts — thread-scoped paths)
- Modify: `src/group-folder.ts` (add resolveThreadGroupPath, resolveThreadIpcPath)
- Create: `src/group-folder-thread.test.ts`

When a container serves a thread session, it gets:
- `/workspace/group` → `groups/{folder}/threads/{thread_ts}/` (read-write, isolated)
- `/workspace/extra/group-shared` → `groups/{folder}/` (read-only, shared CLAUDE.md + knowledge)
- `/workspace/ipc` → `data/ipc/{folder}/threads/{thread_ts}/` (read-write, isolated)
- `/home/node/.claude` → `data/sessions/{folder}/threads/{thread_ts}/.claude/` (read-write, isolated SDK state)

**Step 1: Write the failing test**

Create `src/group-folder-thread.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Mock config before importing
vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/test-data',
  GROUPS_DIR: '/tmp/test-groups',
}));

import { resolveThreadGroupPath, resolveThreadIpcPath } from './group-folder.js';

describe('thread-scoped path resolution', () => {
  it('resolves thread group path', () => {
    const result = resolveThreadGroupPath('cheerful', '1234567890.123456');
    expect(result).toBe('/tmp/test-groups/cheerful/threads/1234567890.123456');
  });

  it('resolves thread IPC path', () => {
    const result = resolveThreadIpcPath('cheerful', '1234567890.123456');
    expect(result).toBe('/tmp/test-data/ipc/cheerful/threads/1234567890.123456');
  });

  it('rejects invalid group folder in thread path', () => {
    expect(() => resolveThreadGroupPath('../escape', '1234.5678'))
      .toThrow();
  });

  it('rejects thread_ts with path traversal', () => {
    expect(() => resolveThreadGroupPath('cheerful', '../../../etc/passwd'))
      .toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/group-folder-thread.test.ts`
Expected: FAIL — functions don't exist

**Step 3: Add thread path helpers to group-folder.ts**

In `src/group-folder.ts`, add after the existing functions:

```typescript
const THREAD_TS_PATTERN = /^\d+\.\d+$/;

function assertValidThreadTs(threadTs: string): void {
  if (!THREAD_TS_PATTERN.test(threadTs)) {
    throw new Error(`Invalid thread_ts "${threadTs}"`);
  }
}

export function resolveThreadGroupPath(folder: string, threadTs: string): string {
  assertValidGroupFolder(folder);
  assertValidThreadTs(threadTs);
  const threadPath = path.resolve(GROUPS_DIR, folder, 'threads', threadTs);
  ensureWithinBase(GROUPS_DIR, threadPath);
  return threadPath;
}

export function resolveThreadIpcPath(folder: string, threadTs: string): string {
  assertValidGroupFolder(folder);
  assertValidThreadTs(threadTs);
  const ipcBaseDir = path.resolve(DATA_DIR, 'ipc');
  const threadIpcPath = path.resolve(ipcBaseDir, folder, 'threads', threadTs);
  ensureWithinBase(ipcBaseDir, threadIpcPath);
  return threadIpcPath;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/group-folder-thread.test.ts`
Expected: PASS

**Step 5: Add threadTs to ContainerInput**

In `src/container-runner.ts:35-45`, add to the `ContainerInput` interface:

```typescript
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  bashSecrets?: string[];
  threadTs?: string; // Slack thread parent timestamp — when set, container uses thread-scoped mounts
}
```

**Step 6: Update buildVolumeMounts for thread-scoped mounts**

In `src/container-runner.ts`, update `buildVolumeMounts` signature to accept `threadTs`:

```typescript
function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
  threadTs?: string,
): { mounts: VolumeMount[]; skillsChanged: boolean } {
```

Add the following imports at the top:
```typescript
import { resolveGroupFolderPath, resolveGroupIpcPath, resolveThreadGroupPath, resolveThreadIpcPath } from './group-folder.js';
```

Then, inside the function, after `const groupDir = resolveGroupFolderPath(group.folder);`, add thread-scoped directory resolution:

```typescript
  // Thread-scoped directories (when processing a specific Slack thread)
  const threadGroupDir = threadTs ? resolveThreadGroupPath(group.folder, threadTs) : null;
  const threadIpcDir = threadTs ? resolveThreadIpcPath(group.folder, threadTs) : null;
```

Update the non-main group mount section (around line 119-136). Replace:

```typescript
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });
```

With:

```typescript
  } else {
    if (threadGroupDir) {
      // Thread session: isolated write dir + shared group knowledge
      fs.mkdirSync(threadGroupDir, { recursive: true });
      mounts.push({
        hostPath: threadGroupDir,
        containerPath: '/workspace/group',
        readonly: false,
      });
      mounts.push({
        hostPath: groupDir,
        containerPath: '/workspace/extra/group-shared',
        readonly: true,
      });
    } else {
      // Non-threaded: group folder is the working directory
      mounts.push({
        hostPath: groupDir,
        containerPath: '/workspace/group',
        readonly: false,
      });
    }
```

Update the sessions directory section (around line 139-212). After `const groupSessionsDir = ...`, add:

```typescript
  // For thread sessions, use thread-scoped sessions directory
  const effectiveSessionsDir = threadTs
    ? path.join(DATA_DIR, 'sessions', group.folder, 'threads', threadTs, '.claude')
    : groupSessionsDir;
  if (threadTs) {
    fs.mkdirSync(effectiveSessionsDir, { recursive: true });
  }
```

Then use `effectiveSessionsDir` instead of `groupSessionsDir` for the settings file check and the mount:

```typescript
  const settingsFile = path.join(effectiveSessionsDir, 'settings.json');
  // ... existing settings.json creation code ...

  // Skills sync uses the base sessions dir (shared across threads)
  // ... existing skills sync code stays the same, using groupSessionsDir ...

  // For thread sessions, copy skills into the thread sessions dir too
  if (threadTs && fs.existsSync(path.join(groupSessionsDir, 'skills'))) {
    const threadSkillsDst = path.join(effectiveSessionsDir, 'skills');
    fs.cpSync(path.join(groupSessionsDir, 'skills'), threadSkillsDst, { recursive: true });
  }

  mounts.push({
    hostPath: effectiveSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });
```

Update the IPC mount section (around line 214-224). Replace:

```typescript
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });
```

With:

```typescript
  const effectiveIpcDir = threadIpcDir || resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(effectiveIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(effectiveIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(effectiveIpcDir, 'input'), { recursive: true });
  mounts.push({
    hostPath: effectiveIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });
```

**Step 7: Update runContainerAgent to pass threadTs**

In `runContainerAgent` (line 339), pass `threadTs` to `buildVolumeMounts`:

```typescript
const { mounts, skillsChanged } = buildVolumeMounts(group, input.isMain, input.threadTs);
```

**Step 8: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 9: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 10: Commit**

```bash
git add src/group-folder.ts src/group-folder-thread.test.ts src/container-runner.ts
git commit -m "feat: thread-scoped container mounts for concurrent sessions"
```

---

### Task 5: GroupQueue and orchestrator sessionKey routing

This is the core change. The GroupQueue itself doesn't need structural changes — it already takes string keys. The orchestrator (index.ts) changes to use sessionKeys and pass threadTs through the pipeline.

**Files:**
- Modify: `src/index.ts:141-258` (processGroupMessages)
- Modify: `src/index.ts:261-343` (runAgent)
- Modify: `src/index.ts:345-452` (startMessageLoop)
- Modify: `src/index.ts:458-470` (recoverPendingMessages)
- Modify: `src/index.ts:584-589` (folderResolver + processMessages setup)

**Step 1: Import session key helpers**

At the top of `src/index.ts`, add:

```typescript
import { buildSessionKey, parseSessionKey } from './session-key.js';
```

**Step 2: Update processGroupMessages to accept sessionKey**

Change the signature from `processGroupMessages(chatJid: string)` to `processGroupMessages(sessionKey: string)`.

Update the function body:

```typescript
async function processGroupMessages(sessionKey: string): Promise<boolean> {
  const { chatJid, threadTs } = parseSessionKey(sessionKey);
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const sinceTimestamp = lastAgentTimestamp[sessionKey] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
    threadTs,  // Filter to this thread only (undefined = all messages)
  );

  if (missedMessages.length === 0) return true;

  // Check if trigger (@mention) is required and present.
  const needsTrigger = group.requiresTrigger !== false;
  if (needsTrigger) {
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        TRIGGER_PATTERN.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) return true;
  }
  const prompt = formatMessages(
    missedMessages,
    needsTrigger ? TRIGGER_PATTERN : undefined,
  );

  // Advance cursor
  const previousCursor = lastAgentTimestamp[sessionKey] || '';
  lastAgentTimestamp[sessionKey] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length, threadTs },
    'Processing messages',
  );

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(sessionKey);
    }, IDLE_TIMEOUT);
  };

  await channel.setTyping?.(chatJid, true);

  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    if (result.result) {
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        await channel.sendMessage(chatJid, text, threadTs);
        outputSentToUser = true;
      }
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(sessionKey);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  }, threadTs);

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    lastAgentTimestamp[sessionKey] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}
```

**Step 3: Update runAgent to accept threadTs and resume thread sessions**

Add `threadTs` parameter to `runAgent`:

```typescript
async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  threadTs?: string,
): Promise<'success' | 'error'> {
```

**Session resume for threads:** Replace the existing `const sessionId = undefined;` with logic that resumes thread sessions. When a thread's container dies after idle timeout (30 min) and the user replies later, a new container should resume the previous SDK session — preserving full conversation context.

The session directory persists on disk at `data/sessions/{folder}/threads/{thread_ts}/.claude/`, so the SDK transcript survives container death. We just need to pass the stored session ID.

```typescript
  const isMain = group.isMain === true;
  const sessionKey = buildSessionKey(chatJid, threadTs);

  // Resume thread sessions across container restarts.
  // Non-threaded channels always start fresh (backward compat).
  // Thread sessions store their session ID so that when the container dies
  // after idle timeout and the user replies later, the new container resumes
  // the SDK transcript with full conversation context.
  const sessionId = threadTs ? sessions[sessionKey] : undefined;
```

In the `runContainerAgent` call, add `threadTs` to the input:

```typescript
  const output = await runContainerAgent(
    group,
    {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid,
      isMain,
      assistantName: ASSISTANT_NAME,
      threadTs,
    },
    (proc, containerName) => {
      const effectiveFolder = threadTs
        ? `${group.folder}/threads/${threadTs}`
        : group.folder;
      queue.registerProcess(sessionKey, proc, containerName, effectiveFolder);
    },
    wrappedOnOutput,
  );
```

Update `wrappedOnOutput` to store session IDs for thread sessions (keyed by sessionKey) so they can be resumed after container death:

```typescript
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          if (threadTs) {
            // Store per-thread session for cross-container resume
            sessions[sessionKey] = output.newSessionId;
            setSession(sessionKey, output.newSessionId);
          } else {
            // Non-threaded: store per-group (used by scheduled tasks)
            sessions[group.folder] = output.newSessionId;
            setSession(group.folder, output.newSessionId);
          }
        }
        await onOutput(output);
      }
    : undefined;
```

**Step 4: Update startMessageLoop to use sessionKeys**

Update the message loop to group messages by sessionKey:

```typescript
        // Deduplicate by session (chatJid + threadTs)
        const messagesBySession = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const sessionKey = buildSessionKey(msg.chat_jid, msg.thread_ts);
          const existing = messagesBySession.get(sessionKey);
          if (existing) {
            existing.push(msg);
          } else {
            messagesBySession.set(sessionKey, [msg]);
          }
        }

        for (const [sessionKey, sessionMessages] of messagesBySession) {
          const { chatJid, threadTs } = parseSessionKey(sessionKey);
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          const needsTrigger = group.requiresTrigger !== false;

          if (needsTrigger) {
            const allowlistCfg = loadSenderAllowlist();
            const hasTrigger = sessionMessages.some(
              (m) =>
                TRIGGER_PATTERN.test(m.content.trim()) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!hasTrigger) continue;
          }

          // Pull all pending messages for this thread since last processing
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[sessionKey] || '',
            ASSISTANT_NAME,
            threadTs,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : sessionMessages;
          const formatted = formatMessages(
            messagesToSend,
            needsTrigger ? TRIGGER_PATTERN : undefined,
          );

          if (queue.sendMessage(sessionKey, formatted, threadTs)) {
            logger.debug(
              { chatJid, threadTs, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[sessionKey] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container for this session — enqueue for a new one
            queue.enqueueMessageCheck(sessionKey);
          }
        }
```

**Step 5: Update folderResolver**

Update the folder resolver to handle sessionKeys:

```typescript
  queue.setFolderResolver((sessionKey: string) => {
    const { chatJid, threadTs } = parseSessionKey(sessionKey);
    const group = registeredGroups[chatJid];
    const baseFolder = group?.folder ?? chatJid;
    if (threadTs) return `${baseFolder}/threads/${threadTs}`;
    return baseFolder;
  });
```

**Step 6: Update recoverPendingMessages**

```typescript
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    // Recover non-threaded pending messages
    const sessionKey = chatJid; // Non-threaded recovery only
    const sinceTimestamp = lastAgentTimestamp[sessionKey] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(sessionKey);
    }
  }
}
```

Note: On process restart, active thread containers are killed but session IDs and SDK transcripts persist on disk. When a user replies in an old thread, a new container starts and resumes the stored session — preserving full conversation history. We don't proactively recover thread sessions on startup (they activate on-demand when a message arrives).

**Step 7: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 8: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 9: Commit**

```bash
git add src/index.ts
git commit -m "feat: sessionKey-based message routing for concurrent thread sessions"
```

---

### Task 6: IPC watcher thread-scoped directory scanning

**Files:**
- Modify: `src/ipc.ts:39-150` (processIpcFiles)

The IPC watcher needs to scan thread-scoped IPC directories in addition to group-level ones. Thread containers write outbound messages and tasks to `data/ipc/{folder}/threads/{threadTs}/messages/` and `.../tasks/`.

**Step 1: Update processIpcFiles to scan thread subdirectories**

In `src/ipc.ts`, inside the `processIpcFiles` function, after the existing per-group scanning loop, add thread subdirectory scanning.

Replace the `for (const sourceGroup of groupFolders)` loop body. After the existing messages/tasks processing for the group, add:

```typescript
      // Scan thread-scoped IPC directories
      const threadsDir = path.join(ipcBaseDir, sourceGroup, 'threads');
      try {
        if (fs.existsSync(threadsDir)) {
          const threadDirs = fs.readdirSync(threadsDir).filter((f) => {
            try {
              return fs.statSync(path.join(threadsDir, f)).isDirectory();
            } catch { return false; }
          });

          for (const threadTs of threadDirs) {
            const threadMessagesDir = path.join(threadsDir, threadTs, 'messages');
            const threadTasksDir = path.join(threadsDir, threadTs, 'tasks');

            // Process thread messages (same logic as group messages)
            try {
              if (fs.existsSync(threadMessagesDir)) {
                const messageFiles = fs
                  .readdirSync(threadMessagesDir)
                  .filter((f) => f.endsWith('.json'));
                for (const file of messageFiles) {
                  const filePath = path.join(threadMessagesDir, file);
                  try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    if (data.type === 'message' && data.chatJid && data.text) {
                      const targetGroup = registeredGroups[data.chatJid];
                      if (
                        isMain ||
                        (targetGroup && targetGroup.folder === sourceGroup)
                      ) {
                        await deps.sendMessage(data.chatJid, data.text);
                        logger.info(
                          { chatJid: data.chatJid, sourceGroup, threadTs },
                          'IPC thread message sent',
                        );
                      } else {
                        logger.warn(
                          { chatJid: data.chatJid, sourceGroup, threadTs },
                          'Unauthorized IPC thread message attempt blocked',
                        );
                      }
                    }
                    fs.unlinkSync(filePath);
                  } catch (err) {
                    logger.error(
                      { file, sourceGroup, threadTs, err },
                      'Error processing IPC thread message',
                    );
                    const errorDir = path.join(ipcBaseDir, 'errors');
                    fs.mkdirSync(errorDir, { recursive: true });
                    fs.renameSync(
                      filePath,
                      path.join(errorDir, `${sourceGroup}-thread-${threadTs}-${file}`),
                    );
                  }
                }
              }
            } catch (err) {
              logger.error(
                { err, sourceGroup, threadTs },
                'Error reading IPC thread messages directory',
              );
            }

            // Process thread tasks (same logic as group tasks)
            try {
              if (fs.existsSync(threadTasksDir)) {
                const taskFiles = fs
                  .readdirSync(threadTasksDir)
                  .filter((f) => f.endsWith('.json'));
                for (const file of taskFiles) {
                  const filePath = path.join(threadTasksDir, file);
                  try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    await processTaskIpc(data, sourceGroup, isMain, deps);
                    fs.unlinkSync(filePath);
                  } catch (err) {
                    logger.error(
                      { file, sourceGroup, threadTs, err },
                      'Error processing IPC thread task',
                    );
                    const errorDir = path.join(ipcBaseDir, 'errors');
                    fs.mkdirSync(errorDir, { recursive: true });
                    fs.renameSync(
                      filePath,
                      path.join(errorDir, `${sourceGroup}-thread-${threadTs}-${file}`),
                    );
                  }
                }
              }
            } catch (err) {
              logger.error({ err, sourceGroup, threadTs }, 'Error reading IPC thread tasks directory');
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error scanning thread IPC directories');
      }
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add src/ipc.ts
git commit -m "feat: IPC watcher scans thread-scoped directories"
```

---

### Task 7: Deploy and verify

**Step 1: Push and deploy**

```bash
git push origin main
# Agent-runner unchanged but container mounts changed, rebuild to be safe
ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
ssh nanoclaw@46.225.110.16 "cd ~/nanoclaw && git pull && ./container/build.sh && npm run build && systemctl --user restart nanoclaw"
```

**Step 2: Kill stale containers and clear sessions**

```bash
ssh nanoclaw@46.225.110.16 "docker ps --format '{{.Names}}' | grep nanoclaw | xargs -r docker kill"
ssh nanoclaw@46.225.110.16 "sqlite3 ~/nanoclaw/store/messages.db 'DELETE FROM sessions'"
ssh nanoclaw@46.225.110.16 "systemctl --user restart nanoclaw"
```

**Step 3: Verify service is running**

```bash
ssh nanoclaw@46.225.110.16 "systemctl --user status nanoclaw"
ssh nanoclaw@46.225.110.16 "tail -20 ~/nanoclaw/logs/nanoclaw.log"
```

**Step 4: Test — first @Cheerful message in channel**

- Send `@Cheerful hello` in a Slack channel
- Verify: response arrives as a threaded reply
- Verify: container logs show `session: new, thread: <ts>`
- Verify: container name includes the group folder

**Step 5: Test — second @Cheerful in different thread (concurrent)**

- While the first thread container is still alive (within 30min idle)
- Send a NEW `@Cheerful what's the weather?` top-level message in the SAME channel
- Verify: a SECOND container starts (check `docker ps`)
- Verify: the second response arrives in its own thread, not the first thread
- Verify: both containers running concurrently

**Step 6: Test — follow-up in existing thread**

- Reply in the first thread WITHOUT @mention: `tell me more`
- Verify: message is piped to the first thread's container (IPC)
- Verify: response appears in the first thread

**Step 7: Test — session resume after idle timeout**

This tests the fix for the "lost context after 30 min" bug:
- Start a thread with `@Cheerful` and have a conversation (2-3 exchanges)
- Wait for the container to die (30 min idle timeout), or manually kill it: `docker ps | grep nanoclaw` then `docker kill <container>`
- Reply in the SAME thread: `can you continue where we left off?`
- Verify: a NEW container starts but **resumes the previous session**
- Verify: container logs show `Starting query (session: <stored-id>, thread: <ts>)` (not `session: new`)
- Verify: the agent has full context from the earlier conversation

**Step 8: Test — non-Slack channels unaffected**

- If other channels are active, send a message there
- Verify: single-session-per-group behavior unchanged
