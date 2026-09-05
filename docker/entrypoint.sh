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
  mkdir -p "$RUNTIME_DIR/profiles/web"
  if [ -f "$config_source/profiles/web/cordis.patch.yml" ]; then
    cp "$config_source/profiles/web/cordis.patch.yml" "$RUNTIME_DIR/profiles/web/cordis.patch.yml"
  elif [ -f "$DSH_HOME/profiles/web/cordis.patch.yml" ]; then
    cp "$DSH_HOME/profiles/web/cordis.patch.yml" "$RUNTIME_DIR/profiles/web/cordis.patch.yml"
  fi
  rm -rf "$DSH_HOME/sessions" "$DSH_HOME/storages" "$DSH_HOME/profiles/web/node_modules"
  ln -s "$state_dir/sessions" "$DSH_HOME/sessions"
  ln -s "$state_dir/storages" "$DSH_HOME/storages"
  ln -s "$PREBUILT_WEB/node_modules" "$DSH_HOME/profiles/web/node_modules"

  # Fill missing image-owned profile files without replacing operator configuration.
  cp -an "$PREBUILT_WEB/." "$DSH_HOME/profiles/web/" 2>/dev/null || true

  # Seed settings.yaml into writable sandbox storages volume
  if [ ! -f "$DSH_HOME/storages/settings.yaml" ]; then
    if [ -f "$config_source/settings.yaml" ]; then
      cp -p "$config_source/settings.yaml" "$DSH_HOME/storages/settings.yaml" 2>/dev/null || true
    elif [ -f "$DSH_HOME/settings.yaml" ]; then
      cp -p "$DSH_HOME/settings.yaml" "$DSH_HOME/storages/settings.yaml" 2>/dev/null || true
    elif [ -f "$DSH_HOME/settings.default.yaml" ]; then
      cp -p "$DSH_HOME/settings.default.yaml" "$DSH_HOME/storages/settings.yaml" 2>/dev/null || true
    fi
  fi
  if [ -f "$RUNTIME_DIR/profiles/web/cordis.patch.yml" ] && ! grep -q "id: settings" "$RUNTIME_DIR/profiles/web/cordis.patch.yml" 2>/dev/null; then
    printf "\n- id: settings\n  config:\n    path: /root/.dsh/storages/settings.yaml\n" >> "$RUNTIME_DIR/profiles/web/cordis.patch.yml"
  fi

  mkdir -p /var/log/dsh && chmod 0750 /var/log/dsh 2>/dev/null || true
}

prepare_standard_home() {
  mkdir -p /var/log/dsh "$RUNTIME_DIR" 2>/dev/null || true
  chmod 0750 /var/log/dsh 2>/dev/null || true

  # Seed prebuilt web profile into writable profiles tmpfs
  mkdir -p \
    "$DSH_HOME/profiles/web" \
    "$DSH_HOME/profiles/node_modules" 2>/dev/null || true
  if [ -d "$PREBUILT_WEB" ]; then
    ln -sf "$PREBUILT_WEB/node_modules" "$DSH_HOME/profiles/web/node_modules" 2>/dev/null || true
    cp -an "$PREBUILT_WEB/." "$DSH_HOME/profiles/web/" 2>/dev/null || true
  fi

  # Seed settings.yaml into writable storages volume to avoid EROFS on read-only DSH_HOME
  mkdir -p "$DSH_HOME/storages" 2>/dev/null || true
  if [ ! -f "$DSH_HOME/storages/settings.yaml" ]; then
    if [ -f "$DSH_HOME/settings.yaml" ]; then
      cp -p "$DSH_HOME/settings.yaml" "$DSH_HOME/storages/settings.yaml" 2>/dev/null || true
    elif [ -f "$DSH_HOME/settings.default.yaml" ]; then
      cp -p "$DSH_HOME/settings.default.yaml" "$DSH_HOME/storages/settings.yaml" 2>/dev/null || true
    fi
  elif [ -f "$DSH_HOME/settings.yaml" ] && [ "$DSH_HOME/settings.yaml" -nt "$DSH_HOME/storages/settings.yaml" ]; then
    cp -p "$DSH_HOME/settings.yaml" "$DSH_HOME/storages/settings.yaml" 2>/dev/null || true
  fi

  # Configure credentials and settings paths inside mutable locations to prevent EROFS on read-only DSH_HOME
  if [ -f "$DSH_HOME/profiles/web/cordis.patch.yml" ] && ! grep -q "id: credentials" "$DSH_HOME/profiles/web/cordis.patch.yml" 2>/dev/null; then
    printf "\n- id: credentials\n  config:\n    path: /run/dsh/.credentials.yaml\n" >> "$DSH_HOME/profiles/web/cordis.patch.yml"
  fi
  if [ -f "$DSH_HOME/profiles/web/cordis.patch.yml" ] && ! grep -q "id: settings" "$DSH_HOME/profiles/web/cordis.patch.yml" 2>/dev/null; then
    printf "\n- id: settings\n  config:\n    path: /root/.dsh/storages/settings.yaml\n" >> "$DSH_HOME/profiles/web/cordis.patch.yml"
  fi

  # Only initialize mutable root files if DSH_HOME is writable
  if [ -w "$DSH_HOME" ]; then
    mkdir -p \
      "$DSH_HOME/storages" \
      "$DSH_HOME/sessions" \
      "$DSH_HOME/patch"
    if [ ! -f "$DSH_HOME/settings.yaml" ] && [ -f "$DSH_HOME/settings.default.yaml" ]; then
      cp "$DSH_HOME/settings.default.yaml" "$DSH_HOME/settings.yaml" 2>/dev/null || true
    fi
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
exec node --expose-internals /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open
