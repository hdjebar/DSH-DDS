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
      --exclude='./profiles/web/node_modules' \
      --exclude='./sessions' \
      --exclude='./storages' \
      --exclude='./phoenix' \
      -cf - . | tar -C "$DSH_HOME" -xf -
  fi

  mkdir -p "$DSH_HOME/profiles/web" "$DSH_HOME/profiles/node_modules" "$DSH_HOME/patch"
  rm -rf "$DSH_HOME/sessions" "$DSH_HOME/storages" "$DSH_HOME/profiles/web/node_modules"
  ln -s "$state_dir/sessions" "$DSH_HOME/sessions"
  ln -s "$state_dir/storages" "$DSH_HOME/storages"
  ln -s "$PREBUILT_WEB/node_modules" "$DSH_HOME/profiles/web/node_modules"

  # Fill missing image-owned profile files without replacing operator configuration.
  cp -an "$PREBUILT_WEB/." "$DSH_HOME/profiles/web/" 2>/dev/null || true
}

prepare_standard_home() {
  mkdir -p \
    "$DSH_HOME/profiles/web" \
    "$DSH_HOME/profiles/node_modules" \
    "$DSH_HOME/storages" \
    "$DSH_HOME/sessions" \
    "$DSH_HOME/patch" \
    "$RUNTIME_DIR"
  cp -an "$PREBUILT_WEB/." "$DSH_HOME/profiles/web/" 2>/dev/null || true
}

if [ "${DSH_SANDBOX:-0}" = "1" ]; then
  echo "[dsh] Preparing disposable sandbox configuration..."
  prepare_sandbox_home
else
  echo "[dsh] Seeding standard profile dependencies..."
  prepare_standard_home
fi

if [ -f "$DSH_HOME/sync_models.mjs" ]; then
  if [ "${DSH_DISABLE_MODEL_SYNC:-0}" = "1" ]; then
    node "$DSH_HOME/sync_models.mjs" || true
  else
    echo "[dsh] Auto-synchronizing multi-provider models..."
    (node "$DSH_HOME/sync_models.mjs" || true) &
  fi
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec /app/entrypoint.upstream.sh
