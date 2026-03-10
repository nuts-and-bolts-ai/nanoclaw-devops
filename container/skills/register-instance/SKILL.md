---
name: register-instance
description: Register a new server instance in the instance registry. Use when a new VPS or server has been set up and needs to be tracked for deployment and monitoring.
---

# Register Instance

## Overview

Add a new server instance to the instance registry so it can be managed by other skills (`/diagnose`, `/deploy`, `/fix`, etc.).

## Instance Registry

The registry lives at `/workspace/group/instance-registry.json`. Each instance has a unique ID and tracks connection details, status, and metadata.

## Workflow

### 1. Gather Instance Details

Ask the user for (or accept as parameters):
- **Name**: human-readable name (e.g., "production-1", "staging", "client-acme")
- **Provider**: hosting provider (hetzner, digitalocean, aws, other)
- **IP address**: public IP of the server
- **SSH user**: usually "root" for VPS instances
- **SSH key**: filename of the key in `/workspace/extra/ssh-keys/`

### 2. Verify Connectivity

Before registering, confirm the instance is reachable:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no -o ConnectTimeout=10 <user>@<ip> "echo 'Connection successful' && uname -a"
```

If the connection fails:
- Check the IP address is correct
- Check the SSH key exists at `/workspace/extra/ssh-keys/<key>`
- Check the SSH user is correct
- Report the error and ask the user to fix the issue before retrying

### 3. Detect Services

Once connected, detect what's running on the instance:

```bash
ssh -i /workspace/extra/ssh-keys/<key> -o StrictHostKeyChecking=no <user>@<ip> bash -s << 'DETECT'
echo "=== Services ==="
systemctl list-units --type=service --state=active --no-pager 2>/dev/null | grep -E "nanoclaw|nginx|docker|node" || echo "none detected"

echo "=== Node ==="
node --version 2>/dev/null || echo "not installed"

echo "=== Docker ==="
docker --version 2>/dev/null || echo "not installed"

echo "=== NanoClaw ==="
ls /opt/nanoclaw/package.json 2>/dev/null && echo "installed at /opt/nanoclaw" || echo "not installed"
DETECT
```

### 4. Add to Registry

Read the current registry, add the new instance, and write it back:

```json
{
  "<instance-id>": {
    "name": "<user-provided name>",
    "provider": "<provider>",
    "ip": "<ip>",
    "ssh_user": "<user>",
    "ssh_key": "<key-filename>",
    "status": "running",
    "created_at": "<ISO-8601 now>",
    "last_checked": "<ISO-8601 now>",
    "services": ["<detected services>"],
    "notes": ""
  }
}
```

The instance ID should be a short, URL-safe identifier derived from the name (e.g., "production-1" becomes "production-1", "Client ACME Server" becomes "client-acme-server").

### 5. Confirm Registration

Report to the user:
- Instance ID and name
- Connection verified
- Services detected
- Registry updated

Suggest next steps:
- Run `/diagnose <instance-id>` for a full health check
- Run `/deploy <instance-id>` to deploy code
- Set up a scheduled task for periodic health checks

## Updating an Existing Instance

If the instance ID already exists in the registry:
- Show the current entry
- Ask the user if they want to update it
- Preserve fields not being changed
- Update `last_checked` timestamp

## Removing an Instance

To remove an instance from the registry:
1. Read the registry
2. Remove the entry by instance ID
3. Write the updated registry
4. Confirm removal (but note that SSH keys are NOT deleted)

## Registry Format Reference

```json
{
  "instances": {
    "<instance-id>": {
      "name": "human-readable name",
      "provider": "hetzner|digitalocean|aws|other",
      "ip": "1.2.3.4",
      "ssh_user": "root",
      "ssh_key": "key-filename",
      "status": "running|stopped|provisioning|error",
      "created_at": "ISO-8601 timestamp",
      "last_checked": "ISO-8601 timestamp",
      "services": ["nanoclaw", "nginx", "etc"],
      "notes": "optional notes"
    }
  }
}
```
