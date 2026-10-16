#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_USER="pi"
ENV_TARGET="/etc/qlcplusmcp.env"

require_node_stack() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node is not installed. Install Node.js >= 20.20.0, then rerun this installer." >&2
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is not installed. Install npm with Node.js >= 20.20.0, then rerun this installer." >&2
    exit 1
  fi

  local node_version
  node_version="$(node -p "process.versions.node")"
  node -e '
    const version = process.versions.node.split(".").map(Number);
    const ok = version[0] > 20 || (version[0] === 20 && version[1] >= 20);
    if (!ok) process.exit(1);
  ' || {
    echo "Error: Node.js ${node_version} is too old. Install Node.js >= 20.20.0; Node 22 LTS is recommended." >&2
    exit 1
  }
}

require_node_stack

echo "Installing QLCPlus-MCP service files..."

if [ ! -e "$ENV_TARGET" ]; then
  sudo cp "$SCRIPT_DIR/qlcplusmcp.env" "$ENV_TARGET"
  echo "Created $ENV_TARGET from the native-only template."
else
  echo "Preserving existing $ENV_TARGET."
fi

sudo cp "$SCRIPT_DIR/qlcplusmcp.service" /etc/systemd/system/qlcplusmcp.service
sudo cp "$SCRIPT_DIR/qlcplusmcp" /usr/local/bin/qlcplusmcp

sudo chown "$SERVICE_USER:$SERVICE_USER" "$ENV_TARGET"
sudo chmod 600 "$ENV_TARGET"
sudo chmod 644 /etc/systemd/system/qlcplusmcp.service
sudo chmod +x /usr/local/bin/qlcplusmcp

sudo systemctl daemon-reload

echo
echo "Installation complete."
echo "Next steps:"
echo "  1) Check $ENV_TARGET"
echo "  2) Make sure /home/pi/QLCPlus-MCP exists, then run: npm ci && npm run build"
echo "  3) Run: qlcplusmcp auto"
echo "  4) Test locally: qlcplusmcp health"
echo "  5) Public Funnel MCP: https://raspberrypi-1.tail70348.ts.net/qlc/mcp"
echo "  6) Public Funnel health: https://raspberrypi-1.tail70348.ts.net/qlc/health"
