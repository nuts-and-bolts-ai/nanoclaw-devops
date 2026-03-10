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

Look up the instance in the registry. **Read the following fields for each instance:**
- `install_path` — where NanoClaw is installed (e.g. `/opt/nanoclaw` or `~/nanoclaw-cheerful`)
- `service_restart` — full command to restart the service (e.g. `systemctl restart nanoclaw` or `systemctl --user restart nanoclaw-cheerful`)
- `service_check` — full command to check the service status (e.g. `systemctl is-active nanoclaw` or `systemctl --user is-active nanoclaw-cheerful`)

If any of these fields are missing, fall back to `/opt/nanoclaw`, `systemctl restart nanoclaw`, and `systemctl is-active nanoclaw` respectively, and warn the user that the registry entry should be updated.

### 2. Pre-Deploy Check

SSH in and verify the instance is in a good state before deploying. Use `<install_path>` and `<service_check>` from the registry:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'PRECHECK'
echo "=== Current commit ==="
cd <install_path> && git log --oneline -1

echo "=== Working tree clean? ==="
cd <install_path> && git status --porcelain

echo "=== Service status ==="
<service_check>

echo "=== Disk space ==="
df -h / | tail -1
PRECHECK
```

If the working tree is dirty, warn the user and ask whether to proceed (changes will be stashed).

### 3. Deploy

Execute the deployment via SSH. Substitute `<install_path>`, `<service_restart>`, and `<service_check>` with the values from the registry:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'DEPLOY'
set -e
cd <install_path>

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
<service_restart>

echo "=== Waiting for startup ==="
sleep 5

echo "=== Service status ==="
<service_check>

echo "=== New commit ==="
git log --oneline -1
DEPLOY
```

### 4. Post-Deploy Verification

Verify the deployment was successful. Use `<service_check>` from the registry:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'VERIFY'
echo "=== Service running? ==="
<service_check>

echo "=== Health check ==="
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "no health endpoint"

echo "=== Recent logs (last 30s) ==="
journalctl --user --since "30 seconds ago" --no-pager 2>/dev/null | tail -10 || \
journalctl --since "30 seconds ago" --no-pager 2>/dev/null | tail -10

echo "=== Process running? ==="
ps aux | grep -E "node.*index" | grep -v grep | head -3
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

If the deployment fails, use `<install_path>`, `<service_restart>`, and `<service_check>` from the registry:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'ROLLBACK'
cd <install_path>
echo "=== Rolling back to previous commit ==="
git checkout HEAD~1
npm install --production
npm run build
<service_restart>
sleep 5
<service_check>
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

## Instance Configuration Fields

The instance registry (`/workspace/group/instance-registry.json`) supports these fields to customize deployment per instance:

| Field | Default | Description |
|---|---|---|
| `install_path` | `/opt/nanoclaw` | Filesystem path where NanoClaw is installed |
| `service_restart` | `systemctl restart nanoclaw` | Full command to restart the service |
| `service_check` | `systemctl is-active nanoclaw` | Full command to check if the service is running |

Always read these from the registry and substitute them into all SSH commands — never hardcode `/opt/nanoclaw` or `systemctl restart nanoclaw`.

## Principles

- **Always pull, never push.** Deploy by pulling from git on the remote, not by copying files.
- **Build on the server.** Run `npm install` and `npm run build` on the target, not locally.
- **Verify after deploy.** Always check that the service came back up.
- **Rollback on failure.** If the service doesn't start, rollback immediately.
- **Sequential for production.** Never deploy to all production instances at once.
- **Use registry values.** Always use `install_path`, `service_restart`, and `service_check` from the instance registry — never hardcode paths or service names.
