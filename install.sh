#!/usr/bin/env bash
# install.sh — Register and start the logswarm service
# Usage:
#   sudo ./install.sh          Install as a systemd service (Linux)
#   ./install.sh --user        Install as a user-level systemd service
#   ./install.sh --uninstall   Remove the logswarm service
set -euo pipefail

SERVICE_NAME="logswarm"
INSTALL_DIR="/opt/logswarm"
BIN_NAME="logswarm"
SYSTEMD_UNIT="${SERVICE_NAME}.service"
CONFIG_DIR="/etc/logswarm"
DATA_DIR="/var/lib/logswarm"
LOG_DIR="/var/log/logswarm"

# ---------- helpers ----------------------------------------------------------
info()  { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
error() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }
die()   { error "$@"; exit 1; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "This operation requires root. Re-run with sudo."
  fi
}

# ---------- detect platform --------------------------------------------------
detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64)  arch="amd64" ;;
    aarch64) arch="arm64" ;;
    armv7l)  arch="armv7" ;;
  esac
  PLATFORM="${os}-${arch}"
  info "Detected platform: ${PLATFORM}"
}

# ---------- build / fetch binary ---------------------------------------------
ensure_binary() {
  if command -v cargo &>/dev/null && [[ -f "Cargo.toml" ]]; then
    info "Building logswarm from source …"
    cargo build --release
    BIN_PATH="target/release/${BIN_NAME}"
  elif [[ -f "target/release/${BIN_NAME}" ]]; then
    BIN_PATH="target/release/${BIN_NAME}"
  elif [[ -f "./${BIN_NAME}" ]]; then
    BIN_PATH="./${BIN_NAME}"
  else
    die "No logswarm binary found. Build the project first with 'cargo build --release'."
  fi
  info "Using binary: ${BIN_PATH}"
}

# ---------- create system user -----------------------------------------------
ensure_service_user() {
  if ! id -u "$SERVICE_NAME" &>/dev/null; then
    info "Creating system user '${SERVICE_NAME}' …"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_NAME"
  fi
}

# ---------- install files ----------------------------------------------------
install_files() {
  info "Installing files …"

  mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"

  install -m 0755 "$BIN_PATH" "${INSTALL_DIR}/${BIN_NAME}"

  # Default configuration (only if not already present)
  if [[ ! -f "${CONFIG_DIR}/config.toml" ]]; then
    cat > "${CONFIG_DIR}/config.toml" <<'TOML'
# logswarm configuration
# See docs/architecture/README.md for the full architecture guide.

[service]
# Unique node identifier (auto-generated on first run if empty)
node_id = ""
# Address the HTTP dashboard binds to
dashboard_bind = "127.0.0.1:8420"

[agents]
# Number of virtual agents in the swarm
count = 8
# Base heartbeat interval in milliseconds
heartbeat_ms = 1000

[backend]
# Primary event store: "spacetimedb" | "firebase" | "memory"
provider = "memory"

[streams]
# Maximum number of concurrent input streams
max_streams = 64
# Size of the ring buffer per stream (number of events)
ring_buffer_size = 4096

[gnn]
# Hidden dimension for graph neural network compression
hidden_dim = 128
# Number of message-passing rounds per tick
message_passes = 3
TOML
    info "Wrote default config → ${CONFIG_DIR}/config.toml"
  fi

  if [[ "${user_mode:-}" != "true" ]]; then
    chown -R "${SERVICE_NAME}:${SERVICE_NAME}" "$DATA_DIR" "$LOG_DIR"
  fi
}

# ---------- systemd unit -----------------------------------------------------
install_systemd_unit() {
  local unit_dir="/etc/systemd/system"
  local user_flag=""
  if [[ "${user_mode:-}" == "true" ]]; then
    unit_dir="${HOME}/.config/systemd/user"
    mkdir -p "$unit_dir"
    user_flag="--user"
  fi

  cat > "${unit_dir}/${SYSTEMD_UNIT}" <<EOF
[Unit]
Description=Logswarm — virtual agent swarm service
Documentation=https://github.com/weichseltree/logswarm/blob/main/docs/architecture/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=${INSTALL_DIR}/${BIN_NAME} --config ${CONFIG_DIR}/config.toml
Restart=on-failure
RestartSec=5s
WatchdogSec=30s

# Sandboxing
User=${SERVICE_NAME}
Group=${SERVICE_NAME}
WorkingDirectory=${DATA_DIR}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Hardening
ProtectSystem=strict
ReadWritePaths=${DATA_DIR} ${LOG_DIR}
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  info "Installed systemd unit → ${unit_dir}/${SYSTEMD_UNIT}"

  systemctl $user_flag daemon-reload
  systemctl $user_flag enable "$SYSTEMD_UNIT"
  systemctl $user_flag start "$SYSTEMD_UNIT"
  info "Service started. Check status with: systemctl $user_flag status ${SERVICE_NAME}"
}

# ---------- uninstall --------------------------------------------------------
uninstall() {
  require_root
  info "Uninstalling logswarm …"
  systemctl stop "$SYSTEMD_UNIT" 2>/dev/null || true
  systemctl disable "$SYSTEMD_UNIT" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SYSTEMD_UNIT}"
  systemctl daemon-reload
  rm -rf "$INSTALL_DIR"
  info "Removed binary and service unit."
  info "Config (${CONFIG_DIR}) and data (${DATA_DIR}) were preserved."
  info "Remove them manually if no longer needed."
}

# ---------- main -------------------------------------------------------------
main() {
  detect_platform

  case "${1:-}" in
    --uninstall)
      uninstall
      ;;
    --user)
      user_mode="true"
      ensure_binary
      install_files
      install_systemd_unit
      ;;
    *)
      require_root
      ensure_binary
      ensure_service_user
      install_files
      install_systemd_unit
      ;;
  esac
}

main "$@"
