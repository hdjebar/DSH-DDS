#!/usr/bin/env bash
set -euo pipefail

# 🧹 Telemetry Storage Pruning & Database Vacuum Maintenance Script
# Enforces rolling telemetry retention (default: 14 days) and database optimization.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHOENIX_DIR="${PHOENIX_DIR:-$SCRIPT_DIR/config/phoenix}"
RETENTION_DAYS="${PHOENIX_MAX_DAYS_RETENTION:-14}"

echo "📊 Starting Phoenix telemetry maintenance..."
echo "  • Directory: $PHOENIX_DIR"
echo "  • Retention Policy: $RETENTION_DAYS days"

if [ ! -d "$PHOENIX_DIR" ]; then
  echo "ℹ️  Phoenix directory $PHOENIX_DIR does not exist. Nothing to prune."
  exit 0
fi

# 1. Prune trace log files older than retention threshold
PRUNED_COUNT=0
if command -v find >/dev/null 2>&1; then
  while IFS= read -r -d '' file; do
    rm -f "$file"
    PRUNED_COUNT=$((PRUNED_COUNT + 1))
  done < <(find "$PHOENIX_DIR" -type f \( -name "*.jsonl" -o -name "*.parquet" -o -name "*.log" \) -mtime +"$RETENTION_DAYS" -print0 2>/dev/null || true)
fi

echo "  • Pruned stale trace files: $PRUNED_COUNT"

# 2. Vacuum SQLite trace databases if sqlite3 is available
for db_file in "$PHOENIX_DIR"/*.db; do
  if [ -f "$db_file" ] && command -v sqlite3 >/dev/null 2>&1; then
    echo "  • Vacuuming $(basename "$db_file")..."
    sqlite3 "$db_file" "PRAGMA auto_vacuum = FULL; VACUUM; PRAGMA optimize;" 2>/dev/null || true
  fi
done

echo "✅ Telemetry maintenance complete."
