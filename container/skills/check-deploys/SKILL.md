---
name: check-deploys
description: Check all managed instances for pending deployments by comparing their deployed commit to the latest on main. Use as a scheduled task or manual check to ensure instances are up to date.
---

# Check Deployments

## Overview

Poll all managed instances to check if they are running the latest code. Compare each instance's deployed git commit against the latest commit on its repo's main branch. Report any instances that are behind and optionally trigger deployments.

## Designed for Scheduled Use

This skill is designed to run as a scheduled task (e.g., every hour or on a cron). It checks all instances, reports status, and can auto-deploy if configured.

Example scheduled task prompt:
```
Check all instances for pending deploys. If any are behind, notify the admin channel with a summary.
```

## Workflow

### 1. Load the Instance Registry

Read `/workspace/group/instance-registry.json` and get all instances with status "running".

### 2. Check Each Instance

For each registered instance, SSH in and compare commits:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no -o ConnectTimeout=10 <user>@<ip> bash -s << 'CHECK'
cd /opt/nanoclaw 2>/dev/null || cd ~/nanoclaw 2>/dev/null || { echo "REPO_NOT_FOUND"; exit 1; }

# Current deployed commit
DEPLOYED=$(git rev-parse --short HEAD)
echo "DEPLOYED=$DEPLOYED"

# Fetch latest from origin
git fetch origin main --quiet 2>/dev/null

# Latest available commit
LATEST=$(git rev-parse --short origin/main)
echo "LATEST=$LATEST"

# How many commits behind
BEHIND=$(git rev-list HEAD..origin/main --count)
echo "BEHIND=$BEHIND"

# Service status
STATUS=$(systemctl is-active nanoclaw 2>/dev/null || echo "unknown")
echo "SERVICE=$STATUS"
CHECK
```

### 3. Build Summary

Produce a summary table of all instances:

```
Instance        Deployed    Latest      Behind    Service
production-1    abc1234     def5678     3         active
staging-1       def5678     def5678     0         active
dev-1           --          --          --        SSH failed
```

### 4. Report Results

**If all instances are up to date:**
- Report that everything is current
- Update `last_checked` timestamps in the registry

**If instances are behind:**
- List which instances need deployment
- Show the commits they are missing
- Ask the user if they want to deploy now (interactive) or send a notification (scheduled)

**If an instance is unreachable:**
- Mark it in the report
- Update the instance status to "error" in the registry if it was previously "running"
- Flag for follow-up with `/diagnose`

### 5. Optional Auto-Deploy

If configured for auto-deploy (e.g., via a flag in the instance registry or scheduled task prompt):

1. Only auto-deploy to instances marked for auto-deploy
2. Deploy to staging instances first
3. Wait and verify staging is healthy
4. Then deploy to production instances sequentially
5. Use the `/deploy` workflow for each instance

Auto-deploy should never be the default. It must be explicitly requested.

## Instance Registry Extensions

Instances can have optional deploy-related fields:

```json
{
  "auto_deploy": false,
  "deploy_order": 1,
  "deploy_group": "staging|production",
  "repo_path": "/opt/nanoclaw"
}
```

These fields are optional. Defaults:
- `auto_deploy`: false
- `deploy_order`: 999 (deploy last)
- `deploy_group`: "production"
- `repo_path`: "/opt/nanoclaw"

## Notification Format

When running as a scheduled task, send a concise notification:

```
*Deploy Check*

All 3 instances up to date.
```

Or:

```
*Deploy Check*

2 of 3 instances need updates:
- production-1: 3 commits behind (last deploy: 2h ago)
- staging-1: 1 commit behind (last deploy: 5h ago)

Reply "deploy all" to update, or "deploy staging-1" for specific instance.
```

## Principles

- **Non-destructive by default.** Only report, never auto-deploy unless explicitly configured.
- **Check all instances.** Don't skip any registered instance.
- **Fail gracefully.** If one instance is unreachable, still check the rest.
- **Update the registry.** Always update `last_checked` after a successful check.
