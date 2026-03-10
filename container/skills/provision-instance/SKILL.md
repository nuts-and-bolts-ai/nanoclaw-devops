---
name: provision-instance
description: Provision a new NanoClaw instance end-to-end — create a VPS via Hetzner API, bootstrap it, clone the repo, configure, and register it. Use when the user wants to spin up a new deployment.
---

# Provision New Instance

## Overview

End-to-end provisioning of a new NanoClaw instance: create a VPS on Hetzner, run the bootstrap script, clone and configure the repo, start the service, and register the instance in the registry.

## Prerequisites

- `HETZNER_API_TOKEN` must be set in the environment (see `.env.example`)
- SSH key must already exist at `/workspace/extra/ssh-keys/` (or a new one will be generated)
- The git repository URL must be known

## Workflow

### 1. Gather Parameters

Ask the user for (or accept as parameters):
- **Instance name**: human-readable name (e.g., "production-2", "client-acme")
- **Server type**: Hetzner server type (default: "cx22" — 2 vCPU, 4GB RAM)
- **Location**: Hetzner datacenter (default: "nbg1" — Nuremberg)
- **Image**: OS image (default: "ubuntu-24.04")
- **SSH key name**: which SSH key to use (from `/workspace/extra/ssh-keys/`)

### 2. Create the VPS

Use the Hetzner API to create the server:

```bash
# Get the SSH key fingerprint to register with Hetzner
SSH_KEY_PATH="/workspace/extra/ssh-keys/<key-name>"

# Check if the SSH key is already registered with Hetzner
EXISTING_KEYS=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
  "https://api.hetzner.cloud/v1/ssh_keys")

# If not registered, add it
SSH_PUB_KEY=$(cat "${SSH_KEY_PATH}.pub" 2>/dev/null || ssh-keygen -y -f "$SSH_KEY_PATH")
HETZNER_KEY_ID=$(echo "$EXISTING_KEYS" | jq -r ".ssh_keys[] | select(.public_key == \"$SSH_PUB_KEY\") | .id")

if [ -z "$HETZNER_KEY_ID" ]; then
  HETZNER_KEY_ID=$(curl -s -X POST -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"nanoclaw-<instance-name>\", \"public_key\": \"$SSH_PUB_KEY\"}" \
    "https://api.hetzner.cloud/v1/ssh_keys" | jq -r '.ssh_key.id')
fi

# Create the server
RESPONSE=$(curl -s -X POST -H "Authorization: Bearer $HETZNER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<instance-name>",
    "server_type": "cx22",
    "location": "nbg1",
    "image": "ubuntu-24.04",
    "ssh_keys": ['"$HETZNER_KEY_ID"'],
    "labels": {
      "managed-by": "nanoclaw-devops",
      "instance": "<instance-name>"
    }
  }' \
  "https://api.hetzner.cloud/v1/servers")

SERVER_ID=$(echo "$RESPONSE" | jq -r '.server.id')
SERVER_IP=$(echo "$RESPONSE" | jq -r '.server.public_net.ipv4.ip')
echo "Server created: ID=$SERVER_ID IP=$SERVER_IP"
```

### 3. Wait for Server to be Ready

Poll the Hetzner API until the server status is "running":

```bash
while true; do
  STATUS=$(curl -s -H "Authorization: Bearer $HETZNER_API_TOKEN" \
    "https://api.hetzner.cloud/v1/servers/$SERVER_ID" | jq -r '.server.status')
  if [ "$STATUS" = "running" ]; then
    echo "Server is running"
    break
  fi
  echo "Server status: $STATUS — waiting..."
  sleep 10
done

# Wait for SSH to become available
for i in $(seq 1 30); do
  if ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$SERVER_IP "echo 'SSH ready'" 2>/dev/null; then
    echo "SSH is available"
    break
  fi
  echo "Waiting for SSH... ($i/30)"
  sleep 10
done
```

### 4. Run the Bootstrap Script

Copy and run the bootstrap script on the new server:

```bash
# Copy the bootstrap script
scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
  /workspace/project/scripts/bootstrap-vps.sh root@$SERVER_IP:/root/bootstrap-vps.sh

# Run it
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no root@$SERVER_IP \
  "bash /root/bootstrap-vps.sh"
```

### 5. Clone and Configure NanoClaw

SSH in and set up the NanoClaw installation:

```bash
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no root@$SERVER_IP bash -s << 'SETUP'
set -e

# Clone the repo as the nanoclaw user
sudo -u nanoclaw git clone <repo-url> /opt/nanoclaw

# Set up environment
cd /opt/nanoclaw
sudo -u nanoclaw cp .env.example .env
echo "Edit /opt/nanoclaw/.env with the correct values"

# Install and build
sudo -u nanoclaw npm install
sudo -u nanoclaw npm run build

# Build the container
sudo -u nanoclaw ./container/build.sh 2>/dev/null || echo "Container build skipped"

# Enable and start the service
systemctl enable nanoclaw
systemctl start nanoclaw

# Wait and verify
sleep 5
systemctl status nanoclaw --no-pager
SETUP
```

### 6. Verify the Instance

Run a quick health check to confirm everything is working:

```bash
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no root@$SERVER_IP bash -s << 'VERIFY'
echo "=== Service status ==="
systemctl is-active nanoclaw

echo "=== Process running ==="
ps aux | grep -E "node.*nanoclaw" | grep -v grep | head -3

echo "=== Recent logs ==="
journalctl -u nanoclaw --since "60 seconds ago" --no-pager | tail -20

echo "=== Disk ==="
df -h /

echo "=== Memory ==="
free -h
VERIFY
```

### 7. Register the Instance

Use the `/register-instance` workflow to add the new instance to the registry, or do it directly:

```bash
# Read current registry
REGISTRY=$(cat /workspace/group/instance-registry.json)

# Add new instance (use jq to modify)
echo "$REGISTRY" | jq '.instances["<instance-id>"] = {
  "name": "<instance-name>",
  "provider": "hetzner",
  "ip": "'$SERVER_IP'",
  "ssh_user": "root",
  "ssh_key": "<key-name>",
  "status": "running",
  "hetzner_server_id": '$SERVER_ID',
  "created_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
  "last_checked": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
  "services": ["nanoclaw"],
  "notes": "Provisioned via /provision-instance"
}' > /workspace/group/instance-registry.json
```

### 8. Report Results

Tell the user:
- Server created: name, IP, Hetzner server ID
- Bootstrap completed: Node.js, Docker, firewall configured
- NanoClaw installed and running
- Instance registered in the registry
- Any warnings or issues from the setup

Remind the user to:
- Edit `/opt/nanoclaw/.env` on the server with the correct API keys and configuration
- Set up WhatsApp authentication if this is a new deployment
- Consider setting up monitoring with scheduled `/diagnose` tasks

## Important Notes

- **Environment file**: The `.env` file on the server needs manual configuration with API keys, WhatsApp credentials, etc. The provisioning script only copies `.env.example`.
- **WhatsApp pairing**: New instances need WhatsApp pairing, which requires interactive setup.
- **DNS**: If the instance needs a domain name, DNS records must be configured separately.
- **Backups**: Consider enabling Hetzner backups for production instances.

## Error Handling

- If the Hetzner API returns an error, report it and stop
- If the bootstrap script fails, SSH in and check `/var/log/nanoclaw-bootstrap.log`
- If the service doesn't start, run `/diagnose` on the instance
- If SSH never becomes available, check the Hetzner console for the server

## Cleanup on Failure

If provisioning fails partway through, offer to:
1. Delete the Hetzner server (to avoid charges)
2. Remove the SSH key from Hetzner (if it was added)
3. Remove the instance from the registry (if it was added)

```bash
# Delete server
curl -s -X DELETE -H "Authorization: Bearer $HETZNER_API_TOKEN" \
  "https://api.hetzner.cloud/v1/servers/$SERVER_ID"
```

## Principles

- **Automate everything.** The user should only need to provide a name and confirm.
- **Secure by default.** Firewall, fail2ban, SSH hardening are all applied automatically.
- **Verify each step.** Don't proceed if a step fails.
- **Clean up on failure.** Don't leave orphaned servers running and incurring charges.
- **Register immediately.** Add to the instance registry so other skills can manage it.
