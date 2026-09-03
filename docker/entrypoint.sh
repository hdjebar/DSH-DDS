#!/bin/sh
set -eu

DSH_HOME="/root/.dsh"
PREBUILT_WEB="/app/prebuilt-profiles/web"
RUNTIME_DIR="${DSH_RUNTIME_DIR:-$DSH_HOME}"

prepare_sandbox_home() {
  config_source="${DSH_CONFIG_SOURCE:-/opt/dsh-config}"
  state_dir="${DSH_SESSION_STATE_DIR:-/var/lib/dsh-state}"

  mkdir -p "$DSH_HOME" "$RUNTIME_DIR" "$state_dir/sessions" "$state_dir/storages"

  if [ -d "$config_source" ]; then
    tar -C "$config_source" \
      --exclude='node_modules' \
      --exclude='*/node_modules' \
      --exclude='*node_modules*' \
      --exclude='*.pnpm*' \
      --exclude='./sessions' \
      --exclude='./storages' \
      --exclude='./phoenix' \
      -cf - . | tar --no-same-owner -C "$DSH_HOME" -xf -
  fi

  mkdir -p "$DSH_HOME/profiles/web" "$DSH_HOME/profiles/node_modules" "$DSH_HOME/patch"
  rm -rf "$DSH_HOME/sessions" "$DSH_HOME/storages" "$DSH_HOME/profiles/web/node_modules"
  ln -s "$state_dir/sessions" "$DSH_HOME/sessions"
  ln -s "$state_dir/storages" "$DSH_HOME/storages"
  ln -s "$PREBUILT_WEB/node_modules" "$DSH_HOME/profiles/web/node_modules"

  # Fill missing image-owned profile files without replacing operator configuration.
  cp -an "$PREBUILT_WEB/." "$DSH_HOME/profiles/web/" 2>/dev/null || true
  mkdir -p /var/log/dsh && chmod 0750 /var/log/dsh 2>/dev/null || true
}

prepare_standard_home() {
  mkdir -p \
    "$DSH_HOME/profiles/web" \
    "$DSH_HOME/profiles/node_modules" \
    "$DSH_HOME/storages" \
    "$DSH_HOME/sessions" \
    "$DSH_HOME/patch" \
    "$RUNTIME_DIR" \
    /var/log/dsh
  chmod 0750 /var/log/dsh 2>/dev/null || true
  cp -an "$PREBUILT_WEB/." "$DSH_HOME/profiles/web/" 2>/dev/null || true
  if [ ! -f "$DSH_HOME/settings.yaml" ] && [ -f "$DSH_HOME/settings.default.yaml" ]; then
    cp "$DSH_HOME/settings.default.yaml" "$DSH_HOME/settings.yaml"
  fi
}

if [ "${DSH_SANDBOX:-0}" = "1" ]; then
  echo "[dsh] Preparing disposable sandbox configuration..."
  prepare_sandbox_home
else
  echo "[dsh] Seeding standard profile dependencies..."
  prepare_standard_home
fi

start_sync_watcher() {
  (
    while true; do
      if [ -f "/tmp/dsh-sync.trigger" ]; then
        rm -f "/tmp/dsh-sync.trigger"
        echo "[dsh-daemon] In-session model sync triggered via /tmp/dsh-sync.trigger..."
        node "$DSH_HOME/sync_models.mjs" || true
      fi
      sleep 2
    done
  ) &
}

if [ -f "$DSH_HOME/sync_models.mjs" ]; then
  if [ "${DSH_DISABLE_MODEL_SYNC:-0}" = "1" ]; then
    node "$DSH_HOME/sync_models.mjs" || true
  else
    echo "[dsh] Auto-synchronizing multi-provider models..."
    (node "$DSH_HOME/sync_models.mjs" || true) &
    start_sync_watcher
  fi
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "[dsh] Launching DeepSeek Harness native service (0.0.0.0:${PORT:-3080})..."
exec node --expose-internals /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --patch "$RUNTIME_DIR/profiles/web/cordis.patch.yml"
