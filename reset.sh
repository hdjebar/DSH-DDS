#!/usr/bin/env bash
set -euo pipefail

# 🧹 DeepSeek Harness & Phoenix Reset Utility
# Safely clears session caches, model sync temp files, or performs full stack reset.

FORCE=false
HARD_RESET=false
FORCE_OFFLINE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hard|-H)
      HARD_RESET=true
      shift
      ;;
    --force|-f|-y)
      FORCE=true
      shift
      ;;
    --force-offline)
      FORCE_OFFLINE=true
      shift
      ;;
    --help|-h)
      echo "Usage: ./reset.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  (default)          Soft reset: clears session histories, cache locks, and temp files"
      echo "  --hard, -H         Hard reset: stops containers, wipes session/storage databases and rebuilds"
      echo "  --force, -f        Bypass confirmation prompt"
      echo "  --force-offline    Bypass container shutdown check when Docker daemon is offline"
      echo "  --help, -h         Show this help message"
      exit 0
      ;;
    *)
      echo "❌ Unknown option '$1'. Use --help for usage."
      exit 1
      ;;
  esac
done

echo "========================================================"
echo "🧹 DeepSeek Harness Workspace Reset"
echo "========================================================"

if [ "$HARD_RESET" = true ]; then
  echo "⚠️  Mode: HARD RESET (All sessions, database caches and volumes will be permanently wiped)"
  if [ "$FORCE" = false ]; then
    read -rp "⚠️  Are you sure you want to PERMANENTLY DELETE all session histories and storage? [y/N]: " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  fi
else
  echo "ℹ️  Mode: SOFT RESET (Clearing temporary cache locks and sync files; sessions preserved)"
  if [ "$FORCE" = false ]; then
    read -rp "Proceed with soft cache reset? [y/N]: " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      exit 0
    fi
  fi
fi

# 1. Stop Docker containers
echo "🛑 Stopping containers..."
if [ "$HARD_RESET" = true ]; then
  if ! docker compose down -v --remove-orphans; then
    if [ "$FORCE_OFFLINE" = true ]; then
      echo "⚠️ Warning: 'docker compose down' failed, but continuing due to --force-offline."
    else
      echo "❌ Error: Failed to stop Docker containers via 'docker compose down'." >&2
      echo "   Aborting reset to prevent state corruption while containers may still be running." >&2
      echo "   To force deletion anyway when Docker daemon is unreachable: ./reset.sh --hard --force-offline" >&2
      exit 1
    fi
  fi
else
  if ! docker compose down; then
    if [ "$FORCE_OFFLINE" = true ]; then
      echo "⚠️ Warning: 'docker compose down' failed, but continuing due to --force-offline."
    else
      echo "❌ Error: Failed to stop Docker containers via 'docker compose down'." >&2
      echo "   Aborting reset to prevent state corruption while containers may still be running." >&2
      echo "   To force deletion anyway when Docker daemon is unreachable: ./reset.sh --force-offline" >&2
      exit 1
    fi
  fi
fi

# 2. Clear caches according to mode
if [ "$HARD_RESET" = true ]; then
  echo "💥 Performing hard reset on containers, persistent databases and session histories..."
  rm -rf config/sessions/* config/storages/* config/phoenix/*.db* config/phoenix/data* config/*.tmp.yaml config/patch*.tmp.yaml config/models.cache.json config/sync_status.json
else
  echo "🧹 Clearing temporary caches and lock files (preserving chat sessions and storage)..."
  rm -rf config/*.tmp.yaml config/patch*.tmp.yaml config/models.cache.json config/sync_status.json config/phoenix/*.db-wal config/phoenix/*.db-shm
fi

# 3. Restart and bootstrap environment
echo "🚀 Restarting Docker stack..."
docker compose up -d

echo "========================================================"
echo "✅ Reset complete! System is clean and ready."
echo "👉 Web UI: http://localhost:3080"
echo "👉 Phoenix: http://localhost:6006"
echo "========================================================"
