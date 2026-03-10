---
name: sync-upstream
description: Merge upstream NanoClaw changes into a managed instance's fork via PR. Use when an instance needs to be updated with the latest upstream changes.
---

# Sync Upstream Changes via PR

## Overview

Pull upstream NanoClaw changes into a managed instance's fork by creating a PR. This is the DevOps version of `/update-nanoclaw` -- instead of running interactively on the developer's machine, it creates a PR that can be reviewed and merged.

## Prerequisites

- Instance must be in the registry with its GitHub repo URL
- The instance's repo must have an `upstream` remote pointing to the NanoClaw source repo
- You need push access to create branches on the instance's fork

## Workflow

### 1. Identify the Instance

Ask the user which instance to sync, or accept it as a parameter. Look up the instance in the registry.

### 2. Clone or Access the Repo

If the project is mounted at `/workspace/project`:
```bash
cd /workspace/project
```

Otherwise, clone the instance's fork:
```bash
git clone <instance-repo-url> /tmp/sync-<instance-id>
cd /tmp/sync-<instance-id>
```

### 3. Set Up Upstream Remote

```bash
# Check if upstream exists
git remote -v | grep upstream

# If not, add it (default: qwibitai/nanoclaw)
git remote add upstream https://github.com/qwibitai/nanoclaw.git

# Fetch latest
git fetch upstream --prune
git fetch origin
```

### 4. Preview Changes

```bash
# Find the merge base
BASE=$(git merge-base origin/main upstream/main)

# Show what upstream has that we don't
echo "=== Upstream commits ==="
git log --oneline $BASE..upstream/main

# Show changed files
echo "=== Changed files ==="
git diff --name-only $BASE..upstream/main

# Dry-run merge to check for conflicts
git merge --no-commit --no-ff upstream/main 2>&1; git diff --name-only --diff-filter=U 2>/dev/null; git merge --abort
```

Report the preview to the user:
- Number of new commits
- Files changed (grouped by category: source, skills, config, docs)
- Whether there are conflicts

### 5. Create the Sync Branch and PR

```bash
# Create sync branch from current main
git checkout -b sync/upstream-$(date +%Y%m%d)
git merge upstream/main --no-edit
```

If there are conflicts:
- Resolve them, preferring upstream for core changes and preserving local customizations
- Document each conflict resolution in the PR description

```bash
# Push and create PR
git push origin sync/upstream-$(date +%Y%m%d)

gh pr create \
  --title "chore: sync upstream NanoClaw changes" \
  --body "## Summary
Merges latest upstream NanoClaw changes into this fork.

## Upstream Commits
<list of commits being merged>

## Conflicts Resolved
<list of conflicts and how they were resolved, or 'None'>

## Testing
- [ ] Build passes
- [ ] Tests pass
- [ ] No breaking changes in CHANGELOG"
```

### 6. Validate

Before creating the PR, ensure the merged code builds:

```bash
npm install
npm run build
npm test 2>/dev/null || echo "No tests configured"
```

If the build fails, fix issues caused by the merge before pushing.

### 7. After the PR

- Tell the user the PR is ready for review
- Note any breaking changes from upstream's CHANGELOG
- If the sync is urgent, suggest merging immediately and using `/deploy`
- Suggest running `/deploy` after the PR is merged

## Automated Sync

This skill can be triggered by a scheduled task to check for upstream updates periodically:

```
Check if upstream/main has new commits. If yes, create a sync PR and notify the admin channel.
```

The scheduled task should only create a PR if one doesn't already exist for the same upstream state.

## Principles

- **Always via PR.** Never force-push upstream changes directly to main.
- **Preserve customizations.** When resolving conflicts, keep local changes unless upstream explicitly supersedes them.
- **Document conflicts.** Every conflict resolution should be explained in the PR.
- **Build before pushing.** The PR should always be in a buildable state.
