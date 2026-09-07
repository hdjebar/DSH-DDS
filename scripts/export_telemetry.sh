#!/usr/bin/env bash
set -euo pipefail

# 📦 Arize Phoenix Telemetry Cold-Storage Export & Sync Script
# Implements Milestone 3 Task B.1:
# Packages trace files, Parquet partitions, and SQLite database snapshots into
# tamper-evident compressed archives with SHA-256 manifests, with optional S3/MinIO sync.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHOENIX_DIR="${PHOENIX_DIR:-$SCRIPT_DIR/config/phoenix}"
ARCHIVE_OUT_DIR="${ARCHIVE_OUT_DIR:-$PHOENIX_DIR/archives}"
S3_BUCKET="${PHOENIX_S3_BUCKET:-${S3_BUCKET:-}}"

TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
ARCHIVE_BASENAME="phoenix_traces_${TIMESTAMP}"
ARCHIVE_TAR="${ARCHIVE_OUT_DIR}/${ARCHIVE_BASENAME}.tar.gz"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/phoenix_export.XXXXXX")

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "📦 Starting Arize Phoenix Telemetry Cold-Storage Export..."
echo "  • Source Directory: $PHOENIX_DIR"
echo "  • Archive Destination: $ARCHIVE_OUT_DIR"

if [ ! -d "$PHOENIX_DIR" ]; then
  echo "⚠️  Phoenix directory '$PHOENIX_DIR' does not exist. Nothing to export."
  exit 0
fi

mkdir -p "$ARCHIVE_OUT_DIR"
mkdir -p "$WORK_DIR/data"

# 1. Collect trace artifacts (.parquet, .db, .jsonl, .log)
FILE_COUNT=0
shopt -s nullglob
for ext in parquet db jsonl log; do
  for file in "$PHOENIX_DIR"/*."$ext"; do
    if [ -f "$file" ]; then
      cp "$file" "$WORK_DIR/data/"
      FILE_COUNT=$((FILE_COUNT + 1))
    fi
  done
done
shopt -u nullglob

# Also copy parquet subdirectories if partitioned
if [ -d "$PHOENIX_DIR/trace_datasets" ]; then
  cp -r "$PHOENIX_DIR/trace_datasets" "$WORK_DIR/data/"
  FILE_COUNT=$((FILE_COUNT + 1))
fi

if [ "$FILE_COUNT" -eq 0 ]; then
  echo "ℹ️  No telemetry trace files found in $PHOENIX_DIR. Nothing to package."
  exit 0
fi

echo "  • Identified $FILE_COUNT telemetry artifact(s) for export."

# 2. Compute SHA-256 cryptographic manifest for tamper evidence
MANIFEST_FILE="$WORK_DIR/manifest.sha256"
(
  cd "$WORK_DIR/data"
  if command -v sha256sum >/dev/null 2>&1; then
    find . -type f -exec sha256sum {} + | sort -k 2 > "$MANIFEST_FILE"
  elif command -v shasum >/dev/null 2>&1; then
    find . -type f -exec shasum -a 256 {} + | sort -k 2 > "$MANIFEST_FILE"
  fi
)

# 3. Create compressed archive
(
  cd "$WORK_DIR"
  tar -czf "$ARCHIVE_TAR" manifest.sha256 data/
)

# Compute archive checksum
ARCHIVE_HASH="unknown"
if command -v sha256sum >/dev/null 2>&1; then
  ARCHIVE_HASH=$(sha256sum "$ARCHIVE_TAR" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  ARCHIVE_HASH=$(shasum -a 256 "$ARCHIVE_TAR" | awk '{print $1}')
fi

echo "✅ Telemetry archive created successfully:"
echo "  • File: $ARCHIVE_TAR"
echo "  • SHA-256: $ARCHIVE_HASH"

# 4. Sync to remote S3 / MinIO cold-storage if configured
if [ -n "$S3_BUCKET" ]; then
  echo "☁️  Syncing archive to remote object storage ($S3_BUCKET)..."
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$ARCHIVE_TAR" "$S3_BUCKET/"
    echo "  • Synced to $S3_BUCKET/${ARCHIVE_BASENAME}.tar.gz"
  else
    echo "⚠️  AWS CLI not installed on host; skipping remote sync."
  fi
fi

echo "🎉 Cold-storage export complete."
