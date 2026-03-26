#!/usr/bin/env bash
#
# logswarm.sh — Summon a swarm of programs to do your computations and daemon
#               the full power of the localhost into your service.
#
# Usage:
#   ./logswarm.sh [--config <path>] [--workers <n>]
#
# Options:
#   --config <path>   Path to configuration file (default: configs/default.toml)
#   --workers <n>     Number of worker processes to spawn (overrides config)
#
# See docs/USAGE.md for full documentation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/configs/default.toml"
WORKERS=""

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --workers)
            WORKERS="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '2,/^$/s/^# \?//p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: Configuration file not found: ${CONFIG_FILE}" >&2
    echo "Run from the project root or pass --config <path>." >&2
    exit 1
fi

ASSETS_DIR="${SCRIPT_DIR}/assets"
if [[ ! -d "$ASSETS_DIR" ]]; then
    echo "Error: Assets directory not found: ${ASSETS_DIR}" >&2
    exit 1
fi

BINARY="${SCRIPT_DIR}/target/release/logswarm"
if [[ ! -x "$BINARY" ]]; then
    BINARY="${SCRIPT_DIR}/target/debug/logswarm"
fi

# ---------------------------------------------------------------------------
# Build if needed
# ---------------------------------------------------------------------------
if [[ ! -x "$BINARY" ]]; then
    echo "Binary not found — building logswarm …"
    (cd "$SCRIPT_DIR" && cargo build --release)
    BINARY="${SCRIPT_DIR}/target/release/logswarm"
fi

# ---------------------------------------------------------------------------
# Launch the swarm
# ---------------------------------------------------------------------------
ARGS=("--config" "$CONFIG_FILE" "--assets-dir" "$ASSETS_DIR")

if [[ -n "$WORKERS" ]]; then
    ARGS+=("--workers" "$WORKERS")
fi

echo "==> Launching logswarm with config ${CONFIG_FILE}"
exec "$BINARY" "${ARGS[@]}"
