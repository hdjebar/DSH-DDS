#!/usr/bin/env bash
set -euo pipefail

# 🧹 DeepSeek Harness & Phoenix Reset Utility
# Safely clears session caches, model sync temp files, or performs full stack reset.

FORCE=false
HARD_RESET=false
PURGE_SESSIONS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hard|-H)
      HARD_RESET=true
      PURGE_SESSIONS=true
      shift
      ;;
    --sessions|-S)
      PURGE_SESSIONS=true
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
      echo "  (default)     Soft reset: restarts the stack and clears temp patches and Phoenix WAL"
      echo "                files only. Chat sessions and agent storage are PRESERVED."
      echo "  --sessions,-S Also DELETE all chat transcripts (config/sessions) and agent"
      echo "                storage (config/storages). This is not recoverable."
      echo "  --hard, -H    Everything --sessions does, plus removes Docker volumes"
      echo "                (docker compose down -v) before rebuilding."
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
  echo "⚠️  Mode: HARD RESET"
  echo "   Will DELETE: config/sessions/*, config/storages/*, and all Docker volumes."
elif [ "$PURGE_SESSIONS" = true ]; then
  echo "⚠️  Mode: SESSION PURGE"
  echo "   Will DELETE: config/sessions/*, config/storages/*. Docker volumes are kept."
else
  echo "ℹ️  Mode: SOFT RESET"
  echo "   Will DELETE: temp patch files and Phoenix WAL/SHM files only."
  echo "   Chat transcripts and agent storage are PRESERVED (use --sessions to clear them)."
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
echo "🧹 Clearing temporary patch files and database journals..."
rm -f config/patch.*.tmp.yaml config/*.tmp.yaml
rm -f config/phoenix/*.db-wal config/phoenix/*.db-shm

if [ "$PURGE_SESSIONS" = true ]; then
  echo "🗑️  Deleting chat transcripts and agent storage..."
  rm -rf config/sessions/* config/storages/*
fi

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
