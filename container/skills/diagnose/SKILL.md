---
name: diagnose
description: Diagnose a managed instance by SSHing in and checking logs, services, disk, memory, and connectivity. Use when something seems wrong with a deployment, or for routine health checks.
---

# Diagnose Instance

## Overview

SSH into a managed instance and run a comprehensive health check. Reports on service status, resource usage, recent errors, and connectivity.

## Prerequisites

- Instance must be registered in `/workspace/group/instance-registry.json`
- SSH key for the instance must exist at `/workspace/extra/ssh-keys/<key-name>`

## Workflow

1. **Identify the instance** -- if the user specifies one, look it up in the registry. If not, ask which instance or check all.
2. **SSH in** and run diagnostics:
   ```bash
   ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no -o ConnectTimeout=10 <user>@<ip> '<commands>'
   ```
3. **Report findings** back to the user with clear status indicators.

## Diagnostic Checks

Run these checks via SSH (combine into a single command to minimize connections):

```bash
# System basics
echo "=== UPTIME ===" && uptime
echo "=== DISK ===" && df -h /
echo "=== MEMORY ===" && free -h
echo "=== LOAD ===" && cat /proc/loadavg

# Service status
echo "=== SERVICES ===" && systemctl is-active nanoclaw nginx 2>/dev/null || echo "systemctl not available"

# Recent errors
echo "=== RECENT ERRORS ===" && journalctl -u nanoclaw --since "1 hour ago" --no-pager -p err 2>/dev/null | tail -20

# NanoClaw process
echo "=== NANOCLAW PROCESS ===" && ps aux | grep -E "node|nanoclaw" | grep -v grep

# Network connectivity
echo "=== NETWORK ===" && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "health endpoint not responding"

# Docker/container status (if applicable)
echo "=== CONTAINERS ===" && docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "docker not available"

# Disk I/O and open files
echo "=== OPEN FILES ===" && lsof -i -P -n 2>/dev/null | grep LISTEN | head -10
```

## Interpreting Results

Flag these as problems:
- Disk usage > 85%
- Memory usage > 90%
- Load average > 2x CPU count
- NanoClaw service not active
- Health endpoint returning non-200
- Error logs in the last hour
- Container in unhealthy or restarting state

Flag these as warnings:
- Disk usage > 70%
- Memory usage > 75%
- Uptime < 1 hour (recent restart)
- No recent logs (service may not be running)

## After Diagnosis

- Update `last_checked` timestamp in the instance registry
- If problems are found, summarize them clearly and suggest next steps
- If the user wants to fix something, suggest using `/fix` or provide specific commands
- For critical issues (disk full, service down), offer to take immediate action

## Multi-Instance Check

When checking all instances, run diagnostics in sequence and produce a summary table:

```
Instance        Status    Disk    Memory    Errors
production-1    OK        45%     62%       0
staging-1       WARN      78%     55%       3
dev-1           ERROR     --      --        SSH failed
```

## Error Handling

- If SSH fails: report connection error, check if IP is correct, check if key is valid
- If a command fails: skip it and continue with remaining checks
- If instance is not in registry: tell the user and offer to register it with `/register-instance`
