#!/bin/bash
set -euo pipefail

# bootstrap-vps.sh — Provision a fresh Ubuntu VPS for NanoClaw
# Run this script on a new server to install all dependencies and set up
# the nanoclaw service. Designed for Ubuntu 22.04+ on Hetzner/DigitalOcean.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/.../scripts/bootstrap-vps.sh | bash
#   # or
#   scp bootstrap-vps.sh root@<ip>:/root/ && ssh root@<ip> bash /root/bootstrap-vps.sh

LOG_FILE="/var/log/nanoclaw-bootstrap.log"
NANOCLAW_USER="nanoclaw"
INSTALL_DIR="/opt/nanoclaw"
NODE_MAJOR=22

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# --- Preflight checks ---

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: This script must be run as root."
  exit 1
fi

if ! grep -qi 'ubuntu\|debian' /etc/os-release 2>/dev/null; then
  echo "WARNING: This script is designed for Ubuntu/Debian. Proceeding anyway..."
fi

log "=== NanoClaw VPS Bootstrap started ==="

# --- System updates ---

log "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

# --- Install essential packages ---

log "Installing essential packages..."
apt-get install -y -qq \
  curl \
  wget \
  git \
  build-essential \
  python3 \
  ufw \
  fail2ban \
  unattended-upgrades \
  jq \
  sqlite3 \
  htop \
  tmux

# --- Install Node.js ---

log "Installing Node.js ${NODE_MAJOR}..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y -qq nodejs
fi

NODE_VERSION=$(node --version)
log "Node.js installed: ${NODE_VERSION}"

# --- Install Docker ---

log "Installing Docker..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

DOCKER_VERSION=$(docker --version)
log "Docker installed: ${DOCKER_VERSION}"

# --- Create nanoclaw user ---

log "Setting up nanoclaw user..."
if ! id "$NANOCLAW_USER" &>/dev/null; then
  useradd -r -m -s /bin/bash -d /home/$NANOCLAW_USER $NANOCLAW_USER
  usermod -aG docker $NANOCLAW_USER
  log "Created user: $NANOCLAW_USER"
else
  log "User $NANOCLAW_USER already exists"
fi

# --- Create installation directory ---

log "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
chown $NANOCLAW_USER:$NANOCLAW_USER "$INSTALL_DIR"

# --- Firewall setup ---

log "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
# Allow Docker containers to reach the credential proxy on the host
ufw allow from 172.17.0.0/16 to any port 3001
ufw --force enable
log "Firewall enabled: SSH + Docker bridge to credential proxy"

# --- Configure fail2ban ---

log "Configuring fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# --- Configure automatic security updates ---

log "Enabling automatic security updates..."
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTOUPGRADE'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTOUPGRADE

# --- SSH hardening ---

log "Hardening SSH..."
if grep -q "^PasswordAuthentication" /etc/ssh/sshd_config; then
  sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
else
  echo "PasswordAuthentication no" >> /etc/ssh/sshd_config
fi

if grep -q "^PermitRootLogin" /etc/ssh/sshd_config; then
  sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
else
  echo "PermitRootLogin prohibit-password" >> /etc/ssh/sshd_config
fi

systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true

# --- Create systemd service ---

log "Creating systemd service..."
cat > /etc/systemd/system/nanoclaw.service << 'SERVICE'
[Unit]
Description=NanoClaw Agent
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=nanoclaw
Group=nanoclaw
WorkingDirectory=/opt/nanoclaw
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nanoclaw

# Security
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/nanoclaw

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
log "Systemd service created (not started — clone repo first)"

# --- Set up log rotation ---

log "Configuring log rotation..."
cat > /etc/logrotate.d/nanoclaw << 'LOGROTATE'
/opt/nanoclaw/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 nanoclaw nanoclaw
}
LOGROTATE

# --- Summary ---

log "=== NanoClaw VPS Bootstrap completed ==="

cat << 'SUMMARY'

=== NanoClaw VPS Bootstrap Complete ===

Next steps:
  1. Clone the repo:
     sudo -u nanoclaw git clone <repo-url> /opt/nanoclaw

  2. Configure environment:
     cp /opt/nanoclaw/.env.example /opt/nanoclaw/.env
     # Edit .env with your settings

  3. Install dependencies and build:
     cd /opt/nanoclaw && sudo -u nanoclaw npm install && sudo -u nanoclaw npm run build

  4. Build the container:
     cd /opt/nanoclaw && sudo -u nanoclaw ./container/build.sh

  5. Start the service:
     systemctl enable nanoclaw
     systemctl start nanoclaw

  6. Check status:
     systemctl status nanoclaw
     journalctl -u nanoclaw -f

SUMMARY
