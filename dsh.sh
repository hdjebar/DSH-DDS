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
  echo "  reset             Safely clear caches & restart stack"
  echo "  status            Show container health status"
  echo "========================================================"
}

case "$COMMAND" in
  up|start)
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
    echo "🔄 Recreating and restarting containers with updated configuration..."
    docker compose up -d --force-recreate
    ;;

  build)
    echo "🔨 Rebuilding container images..."
    docker compose up -d --build
    ;;

  logs)
    shift || true
    docker compose logs -f "$@"
    ;;

  doctor)
    echo "🩺 Running DeepSeek Harness Diagnostics..."
    docker compose exec -T dsh node /root/.dsh/doctor.mjs
    ;;

  sync-models)
    echo "🔄 Running Dynamic Model Synchronizer..."
    docker compose exec -T dsh node /root/.dsh/sync_models.mjs
    ;;

  models)
    echo "📊 DeepSeek Harness Cached Model Catalog:"
    docker compose exec -T dsh node -e "
      import fs from 'fs';
      const file = '/root/.dsh/models.cache.json';
      if (fs.existsSync(file)) {
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
        else
          echo "ℹ️  Notice: Container running in standard mode (without compose sandbox override)."
          echo "   For strict cap_drop and read-only host configs: docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d"
        fi
        docker compose exec -T dsh node /root/.dsh/persona.mjs "$@"
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
      else
        node config/persona.mjs "$@"
      fi
    fi
    ;;

  sessions|session)
    shift || true
    if docker compose ps --status running -q dsh 2>/dev/null | grep -q .; then
      docker compose exec -T dsh node /root/.dsh/persona.mjs sessions "$@"
    else
      node config/persona.mjs sessions "$@"
    fi
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
