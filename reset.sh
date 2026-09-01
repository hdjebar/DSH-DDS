#!/usr/bin/env bash
set -euo pipefail

# 🧹 DeepSeek Harness & Phoenix Reset Utility
# Safely clears session caches, model sync temp files, or performs full stack reset.

FORCE=false
HARD_RESET=false

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
    --help|-h)
      echo "Usage: ./reset.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  (default)     Soft reset: clears session histories, cache locks, and temp files"
      echo "  --hard, -H    Hard reset: stops containers, wipes session/storage databases and rebuilds"
      echo "  --force, -f   Bypass confirmation prompt"
      echo "  --help, -h    Show this help message"
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
  echo "⚠️  Mode: HARD RESET (All sessions, database caches and volumes will be reset)"
else
  echo "ℹ️  Mode: SOFT RESET (Clearing ephemeral session logs and caches)"
fi

if [ "$FORCE" = false ]; then
  read -rp "Are you sure you want to proceed? [y/N]: " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# 1. Stop Docker containers
echo "🛑 Stopping containers..."
docker compose down || true

# 2. Clear ephemeral caches
echo "🧹 Clearing session data and temporary caches..."
rm -rf config/sessions/* config/storages/* config/phoenix/*.db-wal config/phoenix/*.db-shm

if [ "$HARD_RESET" = true ]; then
  echo "💥 Performing hard reset on containers and persistent storage..."
  docker compose down -v --remove-orphans || true
fi

# 3. Restart and bootstrap environment
echo "🚀 Restarting Docker stack..."
docker compose up -d

echo "========================================================"
echo "✅ Reset complete! System is clean and ready."
echo "👉 Web UI: http://localhost:3080"
echo "👉 Phoenix: http://localhost:6006"
echo "========================================================"
