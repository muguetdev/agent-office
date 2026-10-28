#!/bin/sh
# Install (or update) a Command Express machines host.
#
# Run as root from this folder on an Ubuntu/Debian server:
#   sudo ./install.sh
#
# It is idempotent: re-running it rebuilds the image (using Docker's cache)
# and re-installs the scripts. It never opens ports and never touches
# authorized_keys (use `ce-machines authorize` for that).
#
# Environment:
#   SKIP_BUILD=1   install the scripts only, do not (re)build the image
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
IMAGE=command-express/machine:latest

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh: run as root" >&2
  exit 1
fi

log() { printf '\n==> %s\n' "$*"; }

# 1. Docker (Ubuntu's docker.io package if Docker is missing).
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker version --format 'Docker {{.Server.Version}}'

if ! command -v python3 >/dev/null 2>&1; then
  log "Installing Python 3"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3
fi

# 2. Machine image.
if [ "${SKIP_BUILD:-}" != "1" ]; then
  log "Building $IMAGE (first build takes several minutes)"
  docker build --pull -t "$IMAGE" "$HERE"
fi

# 3. Control scripts.
log "Installing /usr/local/bin/ce-machines and ce-machines-ssh"
install -m 0755 "$HERE/bin/ce-machines" /usr/local/bin/ce-machines
install -m 0755 "$HERE/bin/ce-machines-ssh" /usr/local/bin/ce-machines-ssh
install -d -m 0755 /usr/local/share/ce-machines
install -m 0644 "$HERE/seccomp/chrome.json" /usr/local/share/ce-machines/seccomp-chrome.json

# Optional settings file (kept if it already exists).
if [ ! -f /etc/ce-machines.json ]; then
  printf '{\n}\n' > /etc/ce-machines.json
  chmod 0644 /etc/ce-machines.json
fi

# Re-apply the office keys' forward whitelists to the current machines.
/usr/local/bin/ce-machines sync-keys >/dev/null

# 4. sshd checks: offices need key login as root and TCP forwarding.
log "Checking sshd settings"
SSHD=$(sshd -T 2>/dev/null || true)
echo "$SSHD" | grep -E '^(permitrootlogin|passwordauthentication|allowtcpforwarding|gatewayports) '
if echo "$SSHD" | grep -qE '^allowtcpforwarding (no|remote)$'; then
  echo "WARNING: AllowTcpForwarding must be 'yes' or 'local' for offices to reach machines." >&2
fi
if echo "$SSHD" | grep -qE '^permitrootlogin (no)$'; then
  echo "WARNING: PermitRootLogin must be 'prohibit-password' for office keys." >&2
fi
if echo "$SSHD" | grep -qE '^passwordauthentication yes$'; then
  echo "WARNING: password logins are enabled; consider PasswordAuthentication no." >&2
fi

log "Done"
/usr/local/bin/ce-machines ping
/usr/local/bin/ce-machines status
