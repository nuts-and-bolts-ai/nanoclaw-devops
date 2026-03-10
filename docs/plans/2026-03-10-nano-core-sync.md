# Nano-Core Cross-Instance Sync

**Date:** 2026-03-10

## Problem

Features are being developed across multiple NanoClaw instances (dev-ops, cheerful, assistant) with no clear strategy for sharing improvements. This leads to duplicated effort and instances falling out of sync on shared infrastructure.

## Design

### Repo Topology

```
qwibitai/nanoclaw (upstream open-source)
        │
        ▼
nanoclaw-dev-ops (nano-core)    ← shared enhancements consolidated here
        │
    ┌───┴───┐
    ▼       ▼
cheerful  assistant  (+ future instances)
```

### Rules

- **Dev-ops is the nano-core source of truth** for shared enhancements
- Dev-ops merges from `upstream` periodically to stay current with open-source base
- Features developed on other instances get cherry-picked into dev-ops first, then other instances pull from dev-ops
- Instance-specific skills/config never land in dev-ops
- Other instances add dev-ops as a remote: `git remote add core https://github.com/nuts-and-bolts-ai/nanoclaw-devops.git`

### What's Shared vs Instance-Specific

**Shared (lives in dev-ops):**
- Core engine improvements (concurrent thread sessions, container runner)
- Channel fixes (Slack file_share, event filtering, thread routing)
- Dashboard + cost tracking
- Config defaults (MAX_CONCURRENT_CONTAINERS, timeouts)
- DB schema changes
- IPC protocol changes

**Instance-specific (stays on each fork):**
- `groups/` folder and per-group CLAUDE.md
- Channel configuration (tokens, bot names, which channels enabled)
- Instance-specific skills
- `.env` and credentials
- Custom routing logic unique to that instance

**Gray area — traded directly between instances:**
- Skills useful to 2+ instances but not all (cherry-pick directly, no need to go through dev-ops)

## Immediate Changes to Pull In

### 1. MAX_CONCURRENT_CONTAINERS 5→8

- **Source:** cheerful `09981e3`
- **File:** `src/config.ts`
- **Scope:** One-line default change

### 2. Slack file_share fix

- **Source:** cheerful `426f3f9`
- **File:** `src/channels/slack.ts`
- **Scope:** Allow `file_share` subtype through event filter, append file metadata to message content, fix optional chaining on `msg.text`
- **Note:** Will need conflict resolution against concurrent-threads changes already in this repo

### 3. Scheduled task thread routing fix

- **Source:** cheerful `2266fb8`
- **Files:** `src/channels/slack.ts`, `src/index.ts`, `src/ipc.ts`
- **Scope:** Remove `threadTargets` fallback from `sendMessage` — messages only go to a thread when `threadTs` is explicitly passed. IPC thread messages now pass `threadTs` through.
- **Note:** Touches same files as concurrent-threads work; manual conflict resolution expected

### 4. Dashboard with cost tracking

- **Source:** assistant PR #1 (`3efc59c`)
- **Files:** New: `src/dashboard-server.ts` (356 lines), `src/dashboard-data.ts` (356 lines). Modified: `src/index.ts`, `src/db.ts`, `src/container-runner.ts`, `src/ipc.ts`, `src/config.ts`, `src/credential-proxy.ts`, `src/group-queue.ts`, `src/channel-routing.ts`, and others
- **Scope:** Full dashboard feature with cost tracking and activity feed
- **Note:** Largest change; touches many files that already have concurrent-threads modifications. Cherry-pick the merge commit, resolve conflicts.

### Recommended Order

1. Config bump (trivial, no conflicts)
2. File_share fix (isolated Slack change)
3. Thread routing fix (small, touches Slack + IPC)
4. Dashboard (largest, do last when other changes are settled)
