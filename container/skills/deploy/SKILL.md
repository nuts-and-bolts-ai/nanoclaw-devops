---
name: deploy
description: Deploy the latest code to a managed instance via SSH after a PR has been merged. Use when new code needs to go live on a server.
---

# Deploy to Instance

## Overview

SSH into a managed instance and deploy the latest code from its git repository. This skill handles the full deployment cycle: pull, build, restart, and verify.

## Prerequisites

- Instance must be in the registry at `/workspace/group/instance-registry.json`
- SSH key must exist at `/workspace/extra/ssh-keys/<key-name>`
- The PR should already be merged to main before deploying

## Workflow

### 1. Identify the Target

Ask the user:
- Which instance to deploy to? (or "all")
- Is there a specific PR or commit to deploy? (default: latest main)
- Any reason to be cautious? (production vs staging)

Look up the instance in the registry.

### 2. Pre-Deploy Check

SSH in and verify the instance is in a good state before deploying:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'PRECHECK'
echo "=== Current commit ==="
cd /opt/nanoclaw && git log --oneline -1

echo "=== Working tree clean? ==="
cd /opt/nanoclaw && git status --porcelain

echo "=== Service status ==="
systemctl is-active nanoclaw

echo "=== Disk space ==="
df -h / | tail -1
PRECHECK
```

If the working tree is dirty, warn the user and ask whether to proceed (changes will be stashed).

### 3. Deploy

Execute the deployment via SSH:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'DEPLOY'
set -e
cd /opt/nanoclaw

echo "=== Stashing any local changes ==="
git stash 2>/dev/null || true

echo "=== Pulling latest ==="
git fetch origin main
git checkout main
git pull origin main

echo "=== Installing dependencies ==="
npm install --production

echo "=== Building ==="
npm run build

echo "=== Rebuilding container ==="
./container/build.sh 2>/dev/null || echo "No container build script"

echo "=== Restarting service ==="
systemctl restart nanoclaw

echo "=== Waiting for startup ==="
sleep 5

echo "=== Service status ==="
systemctl is-active nanoclaw

echo "=== New commit ==="
git log --oneline -1
DEPLOY
```

### 4. Post-Deploy Verification

Verify the deployment was successful:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'VERIFY'
echo "=== Service running? ==="
systemctl is-active nanoclaw

echo "=== Health check ==="
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "no health endpoint"

echo "=== Recent logs (last 30s) ==="
journalctl -u nanoclaw --since "30 seconds ago" --no-pager 2>/dev/null | tail -10

echo "=== Process running? ==="
ps aux | grep -E "node.*nanoclaw" | grep -v grep | head -3
VERIFY
```

### 5. Report Results

Tell the user:
- Previous commit vs new commit
- Whether the service restarted successfully
- Any errors in the startup logs
- Health check result

Update `last_checked` in the instance registry.

## Rollback

If the deployment fails:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'ROLLBACK'
cd /opt/nanoclaw
echo "=== Rolling back to previous commit ==="
git checkout HEAD~1
npm install --production
npm run build
systemctl restart nanoclaw
sleep 5
systemctl is-active nanoclaw
ROLLBACK
```

Tell the user about the rollback and what went wrong.

## Multi-Instance Deploy

When deploying to multiple instances:
1. Deploy to staging first (if available)
2. Verify staging is healthy
3. Deploy to production instances one at a time
4. Verify each before proceeding to the next

Never deploy to all production instances simultaneously.

## Deploy Path

The default NanoClaw installation path on VPS instances is `/opt/nanoclaw`. If an instance uses a different path, it should be noted in the instance registry's `notes` field.

## Principles

- **Always pull, never push.** Deploy by pulling from git on the remote, not by copying files.
- **Build on the server.** Run `npm install` and `npm run build` on the target, not locally.
- **Verify after deploy.** Always check that the service came back up.
- **Rollback on failure.** If the service doesn't start, rollback immediately.
- **Sequential for production.** Never deploy to all production instances at once.
