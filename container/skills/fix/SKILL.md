---
name: fix
description: Investigate and fix a bug on a managed instance's repo, creating a PR with the fix. Use when the user reports a problem that needs a code change, not just a service restart or config tweak.
---

# Fix Bug via PR

## Overview

Investigate a reported issue on an instance's NanoClaw fork, develop a fix, and submit it as a pull request. The fix is applied through the normal PR flow, not by SSHing in and editing files directly.

## Prerequisites

- The instance must be in the registry with its GitHub repo URL
- You need access to the instance's repo (read-only mount at `/workspace/project` or clone via git)
- For SSH-based investigation, the instance must be reachable

## Workflow

### 1. Understand the Problem

Ask the user:
- Which instance is affected?
- What is the symptom? (error message, unexpected behavior, crash)
- When did it start? (after a deploy, after an update, randomly)
- Is it reproducible?

### 2. Investigate

Gather evidence from multiple sources:

**Remote logs (via SSH):**
```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> \
  "journalctl -u nanoclaw --since '2 hours ago' --no-pager | tail -100"
```

**Local code (via project mount):**
- Read the relevant source files at `/workspace/project/`
- Check recent commits: `git -C /workspace/project log --oneline -20`
- Check for recent changes to affected files: `git -C /workspace/project log --oneline -10 -- <file>`

### 3. Develop the Fix

Create a fix branch and make changes:

```bash
cd /workspace/project
git checkout -b fix/<descriptive-name>
```

- Make the minimal change needed to fix the issue
- Do not refactor unrelated code
- Add a comment explaining why the fix is needed if the reason isn't obvious
- Test the fix locally if possible (run build, run tests)

```bash
npm run build
npm test 2>/dev/null || echo "No tests configured"
```

### 4. Create the PR

Push the branch and create a PR:

```bash
cd /workspace/project
git add -A
git commit -m "fix: <concise description of what was fixed>"
git push origin fix/<descriptive-name>
```

Create the PR using the GitHub CLI if available, or instruct the user to create it:

```bash
gh pr create \
  --title "fix: <concise description>" \
  --body "## Problem
<description of the symptom>

## Root Cause
<what was actually wrong>

## Fix
<what this PR changes and why>

## Testing
<how to verify the fix>"
```

### 5. After the PR

- Tell the user the PR is ready for review
- If the fix is urgent, suggest using `/deploy` after the PR is merged
- If the issue was found via `/diagnose`, reference that context

## Principles

- **Minimal fixes only.** Fix the bug, nothing else.
- **Always via PR.** Never SSH in and edit production code directly.
- **Evidence first.** Gather logs and reproduce before guessing at fixes.
- **Explain the root cause.** The PR description should explain why, not just what.
- **Test before pushing.** At minimum, ensure the project builds.

## Error Handling

- If you can't reproduce the issue: ask for more details, check if the issue is environment-specific
- If the repo isn't accessible: ask the user to provide access or clone it manually
- If the fix requires changes to multiple repos: note this and handle each separately
- If the fix is urgent and can't wait for PR review: flag this to the user and suggest they merge immediately
