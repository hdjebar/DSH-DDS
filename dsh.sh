#!/usr/bin/env bash
set -euo pipefail

# 🚀 DSH Universal CLI Control Script
# Provides intuitive commands for managing DeepSeek Harness, Phoenix, and agents.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMMAND="${1:-help}"

print_help() {
  echo "========================================================"
  echo "⚡ DeepSeek Harness (DSH) CLI Controller"
  echo "========================================================"
  echo "Usage: ./dsh.sh [command] [options]"
  echo ""
  echo "Available Commands:"
  echo "  up / start        Start DSH and Arize Phoenix containers"
  echo "  down / stop       Stop all containers"
  echo "  restart           Restart all containers"
  echo "  build             Rebuild container image with latest plugins"
  echo "  logs [service]    View real-time logs (e.g. ./dsh.sh logs dsh)"
  echo "  doctor            Run ecosystem health check & diagnostics"
  echo "  sync-models       Fetch live model catalog (OpenRouter & Google)"
  echo "  models            Inspect cached model catalog & sync timestamp"
  echo "  cli               Launch interactive terminal matrix"
  echo "  run \"<prompt>\"   Execute one-shot autonomous task in headless mode"
  echo "  persona [cmd]     Manage AI Personas (list / create <name> --template <tmpl>)"
  echo "  approve <id>      Issue signed approval token to resume suspended workflow"
  echo "  reset             Safely clear caches & restart stack"
  echo "  status            Show container health status"
  echo "========================================================"
}

ensure_runtime_dirs() {
  mkdir -p "$SCRIPT_DIR/config/sessions/checkpoints" \
           "$SCRIPT_DIR/config/audit" \
           "$SCRIPT_DIR/config/storages" \
           "$SCRIPT_DIR/config/patch" \
           "$SCRIPT_DIR/config/personas" \
           "$SCRIPT_DIR/config/skills" \
           "$SCRIPT_DIR/config/cache" \
           "$SCRIPT_DIR/config/keys" \
           "$SCRIPT_DIR/.host_keys" \
           "$SCRIPT_DIR/workspaces/cases" \
           "$SCRIPT_DIR/workspaces/artifacts"
  if [ ! -f "$SCRIPT_DIR/config/settings.yaml" ] && [ -f "$SCRIPT_DIR/config/settings.default.yaml" ]; then
    cp "$SCRIPT_DIR/config/settings.default.yaml" "$SCRIPT_DIR/config/settings.yaml" 2>/dev/null || true
  fi

  # Auto-generate host approval Ed25519 keypair if missing (FR-011, FR-017)
  mkdir -p "$HOME/.dsh/keys" "$SCRIPT_DIR/config/keys"
  if [ ! -f "$HOME/.dsh/keys/approval_ed25519" ] && [ ! -f "$SCRIPT_DIR/config/keys/approval_ed25519.pub" ]; then
    node -e '
      const crypto = require("crypto");
      const fs = require("fs");
      const path = require("path");
      const os = require("os");
      const privPath = path.join(os.homedir(), ".dsh", "keys", "approval_ed25519");
      const pubPath = path.join(process.cwd(), "config", "keys", "approval_ed25519.pub");
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
      });
      fs.mkdirSync(path.dirname(privPath), { recursive: true });
      fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
      fs.writeFileSync(pubPath, publicKey, { mode: 0o644 });
    ' 2>/dev/null || true
  fi
}

case "$COMMAND" in
  up|start)
    ensure_runtime_dirs
    echo "🚀 Starting DeepSeek Harness and Phoenix stack..."
    docker compose up -d
    echo "👉 Web UI: http://localhost:3080"
    echo "👉 Phoenix Telemetry: http://localhost:6006"
    ;;

  down|stop)
    echo "🛑 Stopping containers..."
    docker compose down
    ;;

  restart)
    ensure_runtime_dirs
    echo "🔄 Recreating and restarting containers with updated configuration..."
    docker compose up -d --force-recreate
    ;;

  build)
    ensure_runtime_dirs
    echo "🔨 Rebuilding container images..."
    docker compose up -d --build
    ;;

  logs)
    shift || true
    docker compose logs -f "$@"
    ;;

  doctor)
    echo "🩺 Running DeepSeek Harness Diagnostics..."
    HOST_ENV_STATUS="ABSENT"
    HOST_ENV_MODE=""
    if [ -f "$SCRIPT_DIR/.env" ]; then
      HOST_ENV_STATUS="PRESENT"
      if stat -f "%Lp" "$SCRIPT_DIR/.env" >/dev/null 2>&1; then
        HOST_ENV_MODE="$(stat -f "%Lp" "$SCRIPT_DIR/.env")"
      elif stat -c "%a" "$SCRIPT_DIR/.env" >/dev/null 2>&1; then
        HOST_ENV_MODE="$(stat -c "%a" "$SCRIPT_DIR/.env")"
      fi
    fi
    docker compose exec -T -e DSH_HOST_ENV_STATUS="$HOST_ENV_STATUS" -e DSH_HOST_ENV_MODE="$HOST_ENV_MODE" dsh node /root/.dsh/doctor.mjs
    ;;

  sync-models)
    echo "🔄 Running Dynamic Model Synchronizer..."
    docker compose exec -T dsh node /root/.dsh/sync_models.mjs
    ;;

  models)
    echo "📊 DeepSeek Harness Cached Model Catalog:"
    docker compose exec -T dsh node -e "
      import fs from 'fs';
      const candidates = [
        '/root/.dsh/cache/models.cache.json',
        '/root/.dsh/storages/models.cache.json',
        '/root/.dsh/models.cache.json',
        'config/cache/models.cache.json',
        'config/storages/models.cache.json',
        'config/models.cache.json'
      ];
      const file = candidates.find(f => fs.existsSync(f));
      if (file) {
        try {
          const c = JSON.parse(fs.readFileSync(file, 'utf8'));
          const orCount = c.providers?.openrouter?.total || 0;
          const geminiCount = c.providers?.gemini?.total ?? c.providers?.google?.total ?? 0;
          const total = c.total ?? (orCount + geminiCount);
          const syncTime = c.updatedAt || c.lastSync || 'unknown';
          console.log(\`  • Total Active Models: \${total}\`);
          console.log(\`  • OpenRouter Models:   \${orCount}\`);
          console.log(\`  • Google Gemini:       \${geminiCount}\`);
          console.log(\`  • Last Synchronized:   \${syncTime}\`);
        } catch (e) {
          console.error('❌ Failed to parse models.cache.json:', e.message);
        }
      } else {
        console.log('  ℹ️ No cached model catalog found. Run: ./dsh.sh sync-models');
      }
    "
    ;;

  cli)
    echo "⌨️ Launching interactive terminal CLI..."
    docker compose exec -it dsh dsh --profile cli
    ;;

  run|headless)
    shift || true
    if [ $# -eq 0 ]; then
      echo "❌ Error: Please provide a prompt. Example: ./dsh.sh run 'summarize files'"
      exit 1
    fi
    docker compose exec -T dsh dsh --profile headless "$@"
    ;;

  reset)
    shift || true
    ./reset.sh "$@"
    ;;

  persona)
    shift || true
    if [ "${1:-}" = "workflow" ] || [ "${1:-}" = "wf" ]; then
      if docker compose ps --status running -q dsh 2>/dev/null | grep -q .; then
        # Check whether container is running with sandbox override
        if docker compose exec -T dsh sh -c '[ "${DSH_SANDBOX:-0}" = "1" ]' 2>/dev/null; then
          echo "🛡️  Executing workflow inside hardened container sandbox (DSH_SANDBOX=1)..."
          docker compose exec -T dsh node /root/.dsh/persona.mjs "$@"
        elif echo "$*" | grep -q -- "--allow-standard-container"; then
          echo "⚠️  Executing workflow in standard container mode (--allow-standard-container supplied)."
          echo "   Kernel Landlock and full volume isolation are relaxed."
          CLEANED_ARGS=()
          for arg in "$@"; do
            if [ "$arg" != "--allow-standard-container" ]; then
              CLEANED_ARGS+=("$arg")
            fi
          done
          docker compose exec -T dsh node /root/.dsh/persona.mjs "${CLEANED_ARGS[@]}"
        else
          echo "❌ Error: Declarative workflows require hardened sandbox profile by default (DSH_SANDBOX=1)."
          echo "   To start the sandbox stack:"
          echo "     docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d"
          echo "   Or pass '--allow-standard-container' to run in the current standard container."
          exit 1
        fi
      elif echo "$*" | grep -q -- "--force-host-unsafe"; then
        echo "⚠️ WARNING: Executing declarative workflow on host due to --force-host-unsafe."
        echo "   Container Landlock, dropped capabilities, and volume isolation are bypassed!"
        CLEANED_ARGS=()
        for arg in "$@"; do
          if [ "$arg" != "--force-host-unsafe" ]; then
            CLEANED_ARGS+=("$arg")
          fi
        done
        node config/persona.mjs "${CLEANED_ARGS[@]}"
      else
        echo "❌ Error: DSH container is offline. Declarative workflows must run inside"
        echo "   the container sandbox to enforce kernel Landlock, dropped capabilities, and filesystem boundaries."
        echo "   Start the container with: ./dsh.sh up"
        echo "   Or override explicitly:   ./dsh.sh persona workflow $* --force-host-unsafe"
        exit 1
      fi
    else
      if docker compose ps --status running -q dsh 2>/dev/null | grep -q .; then
        docker compose exec -T dsh node /root/.dsh/persona.mjs "$@"
      elif echo "$*" | grep -q -- "--force-host-unsafe"; then
        echo "⚠️ WARNING: Executing persona command on host due to --force-host-unsafe."
        CLEANED_ARGS=()
        for arg in "$@"; do
          if [ "$arg" != "--force-host-unsafe" ]; then
            CLEANED_ARGS+=("$arg")
          fi
        done
        node config/persona.mjs "${CLEANED_ARGS[@]}"
      else
        echo "❌ Error: DSH container is offline. To prevent evaluating container-writable files on host,"
        echo "   commands run inside the container by default. Start with: ./dsh.sh up"
        echo "   Or override explicitly: ./dsh.sh persona $* --force-host-unsafe"
        exit 1
      fi
    fi
    ;;

  sessions|session)
    shift || true
    if docker compose ps --status running -q dsh 2>/dev/null | grep -q .; then
      docker compose exec -T dsh node /root/.dsh/persona.mjs sessions "$@"
    elif echo "$*" | grep -q -- "--force-host-unsafe"; then
      echo "⚠️ WARNING: Executing session command on host due to --force-host-unsafe."
      CLEANED_ARGS=()
      for arg in "$@"; do
        if [ "$arg" != "--force-host-unsafe" ]; then
          CLEANED_ARGS+=("$arg")
        fi
      done
      node config/persona.mjs sessions "${CLEANED_ARGS[@]}"
    else
      echo "❌ Error: DSH container is offline. To prevent evaluating container-writable files on host,"
      echo "   commands run inside the container by default. Start with: ./dsh.sh up"
      echo "   Or override explicitly: ./dsh.sh sessions $* --force-host-unsafe"
      exit 1
    fi
    ;;

  approve)
    INSTANCE_ID="${2:-}"
    if [ -z "$INSTANCE_ID" ]; then
      echo "❌ Error: Missing instance ID. Usage: ./dsh.sh approve <instanceId> [--actor=<name>] [--ttl=<seconds>]" >&2
      exit 1
    fi
    # Strict slug validation in shell BEFORE invoking Node (FR-010)
    if [[ ! "$INSTANCE_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
      echo "❌ Error: Invalid instance ID '$INSTANCE_ID'. Only alphanumeric characters, dashes, and underscores are allowed." >&2
      exit 1
    fi

    ACTOR="${USER:-host-operator}"
    TTL="3600"
    shift 2 || shift $#
    while [ $# -gt 0 ]; do
      case "$1" in
        --actor=*)
          ACTOR="${1#--actor=}"
          ;;
        --actor)
          shift
          ACTOR="${1:-host-operator}"
          ;;
        --ttl=*)
          TTL="${1#--ttl=}"
          ;;
        --ttl)
          shift
          TTL="${1:-3600}"
          ;;
      esac
      shift || true
    done

    # Validate ACTOR and TTL formats
    if [[ ! "$ACTOR" =~ ^[a-zA-Z0-9_.-]+$ ]]; then
      echo "❌ Error: Invalid actor '$ACTOR'. Only alphanumeric characters, dots, dashes, and underscores are allowed." >&2
      exit 1
    fi
    if [[ ! "$TTL" =~ ^[0-9]+$ ]]; then
      echo "❌ Error: Invalid TTL '$TTL'. Must be a positive integer in seconds." >&2
      exit 1
    fi

    # Resolve host asymmetric private key or approval secret (FR-011, FR-017)
    APPROVAL_PRIVATE_KEY="${DSH_APPROVAL_PRIVATE_KEY:-}"
    if [ -z "${DSH_APPROVAL_PRIVATE_KEY+x}" ] && [ -f "$HOME/.dsh/keys/approval_ed25519" ]; then
      APPROVAL_PRIVATE_KEY="$(cat "$HOME/.dsh/keys/approval_ed25519")"
    fi

    # Read from environment; only fall back to .env if both are unset
    APPROVAL_SECRET="${DSH_APPROVAL_SECRET:-${DSH_SECRET:-}}"
    if [ -z "${DSH_APPROVAL_SECRET+x}" ] && [ -z "${DSH_SECRET+x}" ] && [ -f "$SCRIPT_DIR/.env" ]; then
      APPROVAL_SECRET="$(grep -E '^DSH_APPROVAL_SECRET=' "$SCRIPT_DIR/.env" | cut -d= -f2- | tr -d ' "' || true)"
      if [ -z "$APPROVAL_SECRET" ]; then
        APPROVAL_SECRET="$(grep -E '^DSH_SECRET=' "$SCRIPT_DIR/.env" | cut -d= -f2- | tr -d ' "' || true)"
      fi
    fi

    if [ -z "$APPROVAL_PRIVATE_KEY" ] && ([ -z "$APPROVAL_SECRET" ] || [ "${#APPROVAL_SECRET}" -lt 16 ]); then
      echo "❌ Error: APPROVAL_SECRET_MISSING. A strong DSH_APPROVAL_SECRET (minimum 16 characters) must be set in your environment or .env." >&2
      exit 1
    fi

    # Execute parameterized script via stdin with arguments passed via process.argv to prevent JS injection
    DSH_APPROVAL_PRIVATE_KEY="$APPROVAL_PRIVATE_KEY" DSH_APPROVAL_SECRET="$APPROVAL_SECRET" node - "$INSTANCE_ID" "$ACTOR" "$TTL" << 'EOF'
      import('fs').then(fs => {
        import('path').then(path => {
          import('./config/declarative-orchestrator.mjs').then(async ({ DeclarativeWorkflowEngine }) => {
            const id = process.argv[2];
            const actor = process.argv[3] || 'host-operator';
            const ttl = Number(process.argv[4]) || 3600;

            const checkpointPath = path.join(process.cwd(), 'config', 'sessions', 'checkpoints', `${id}.json`);
            let cp = null;
            if (fs.existsSync(checkpointPath)) {
              cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
            } else {
              // Try container checkpoint export if running (FR-019)
              try {
                const { execSync } = await import('child_process');
                const raw = execSync(`docker compose exec -T dsh cat /var/lib/dsh-state/sessions/checkpoints/${id}.json 2>/dev/null || docker compose exec -T dsh cat /root/.dsh/sessions/checkpoints/${id}.json 2>/dev/null`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
                if (raw && raw.trim().startsWith('{')) {
                  cp = JSON.parse(raw);
                  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
                  fs.writeFileSync(checkpointPath, JSON.stringify(cp, null, 2), 'utf8');
                }
              } catch {}
            }

            if (!cp) {
              console.error(`❌ Error: Checkpoint not found at ${checkpointPath}`);
              process.exit(1);
            }

            console.log('========================================================');
            console.log('📋 REVIEWING PENDING APPROVAL REQUEST:');
            console.log(`   Instance ID: ${id}`);
            console.log(`   Persona:     ${cp.persona}`);
            console.log(`   Workflow:    ${cp.workflow}`);
            console.log(`   Step:        #${cp.stepIndex} - ${cp.stepName} (${cp.action || (cp.stepDescriptor && cp.stepDescriptor.action) || 'unknown'})`);
            if (cp.stepDescriptor) {
              if (cp.stepDescriptor.target) console.log(`   Target:      ${cp.stepDescriptor.target}`);
              if (cp.stepDescriptor.scope) console.log(`   Scope:       ${cp.stepDescriptor.scope}`);
            }
            console.log(`   Digest:      ${cp.checkpointDigest}`);
            console.log('========================================================\n');

            const token = DeclarativeWorkflowEngine.generateApprovalToken(cp, actor, ttl);
            console.log(`✅ Approved instance: ${id}`);
            console.log(`   Actor: ${actor}`);
            console.log(`   Approval Token: ${token}`);
            console.log('\nResume execution with:');
            console.log(`   ./dsh.sh persona workflow ${cp.persona} --resume=${id} --token=${token}`);
          }).catch(err => {
            console.error(`❌ Error generating approval token: ${err.message}`);
            process.exit(1);
          });
        });
      });
EOF
    ;;

  status)
    echo "📊 Container Status:"
    docker compose ps
    ;;

  help|--help|-h)
    print_help
    exit 0
    ;;

  *)
    echo "❌ Unknown command '$COMMAND'. Run './dsh.sh help' for usage."
    exit 1
    ;;
esac
