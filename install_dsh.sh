#!/usr/bin/env bash
# Ultimate Single-File DeepSeek Harness Deployment Script (Automated .env Reader)
set -e

# 1. Smart Path & Variable Injection Layer
if [ -f ".env" ]; then
  echo "📝 Found existing local .env file. Injecting variables..."
  # Export variables from .env safely without breaking strings
  export $(grep -v '^#' .env | xargs)
else
  echo "⚠️  No local .env file found in this folder."
  echo "👉 Please create a .env file with your GEMINI_API_KEY first."
  exit 1
fi

# Dynamically bind to current working directory if not pre-set
export DSH_INSTALL="${DSH_INSTALL:-$(pwd)}"
echo "🚀 Setting up DeepSeek Harness at: $DSH_INSTALL"

echo "📦 Setting up directory tree structure..."
mkdir -p "$DSH_INSTALL/config" \
         "$DSH_INSTALL/workspaces"

# 2. Write Active Cordis Patch Configuration (Dual Gemini + OpenRouter Native Architecture)
cat << 'EOF' > "$DSH_INSTALL/config/cordis.patch.yml"
- id: llm-deepseek
  disabled: true
- id: web-search-deepseek
  disabled: true
- id: web
  config:
    searchProvider: modsearch
    defaultWorkspacePath: /workspaces
- id: find-dsh-plugin
  config:
    search_paths:
      - /workspaces
    exclude_patterns:
      - "**/node_modules/**"
      - "**/.git/**"
      - "**/.venv/**"
- id: better-sidebar
  config:
    layout: vscode-classic
    persistent_terminal: true
- id: model-sync
  config:
    auto_poll_on_startup: true
    sync_interval_hours: 12
    enable_quota_ui_widget: true
- id: mnemon
  config:
    enable_per_workspace_memory: true
    auto_index_project_briefs: true
- id: llm-pi-ai
  config:
    providers:
      gemini:
        apiKeyEnv: GEMINI_API_KEY
        displayName: "Google AI Studio (Gemini)"
        api: openai-completions
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
        compat:
          supportsStore: false
        models:
          - id: "gemini-3.7-flash"
            name: "Google: Gemini 3.7 Flash"
            contextWindow: 1048576
            maxTokens: 8192
            input: ["text", "image"]
            compat:
              supportsStore: false
          - id: "gemini-3.1-pro"
            name: "Google: Gemini 3.1 Pro"
            contextWindow: 1048576
            maxTokens: 8192
            input: ["text", "image"]
            compat:
              supportsStore: false
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
        displayName: "OpenRouter"
        api: openai-completions
        baseURL: "https://openrouter.ai/api/v1"
        models:
          - id: "deepseek/deepseek-chat"
            name: "DeepSeek: DeepSeek V3"
          - id: "openai/gpt-4o"
            name: "OpenAI: GPT-4o"
          - id: "anthropic/claude-3.5-sonnet"
            name: "Anthropic: Claude 3.5 Sonnet"
- id: agent-default-model
  config:
    provider: gemini
    model: gemini-3.7-flash
EOF

# 3. Write Multi-Stage Dockerfile (pnpm builder + minimal runtime)
cat << 'EOF' > "$DSH_INSTALL/Dockerfile"
# ── Stage 1: Multi-Stage Builder with pnpm ───────────────────────
FROM smanx/deepseek-harness:latest AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /root/.dsh/profiles/web
COPY config/profiles/web/package.json ./package.json

RUN pnpm install \
    && pnpm approve-builds --all || true \
    && pnpm prune --prod \
    && rm -rf /root/.cache /root/.npm

# ── Stage 2: Minimal Production Runtime ───────────────────────────
FROM smanx/deepseek-harness:latest AS runner

# Retain pnpm for on-the-fly dynamic Web UI plugin installations
RUN npm install -g pnpm && npm cache clean --force

# Copy pre-compiled and pre-built plugins
COPY --from=builder /root/.dsh/profiles/web /root/.dsh/profiles/web

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
EOF

# 4. Write Production Docker Compose Layout with build and log rotation
cat << 'EOF' > "$DSH_INSTALL/docker-compose.yml"
services:
  dsh:
    build: .
    image: dsh-local:latest
    container_name: dsh-local
    restart: unless-stopped
    ports:
      - "${DSH_PORT:-3080}:3080"
    volumes:
      - ./config:/root/.dsh
      - ./workspaces:/workspaces
    environment:
      - PORT=3080
      - NODE_ENV=production
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
      - GEMINI_API_KEY=${GEMINI_API_KEY:-}
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF

echo "=========================================================="
echo "✅ Architecture built cleanly inside your current folder!"
echo "🛠️  Execution Steps:"
echo "  1. Build & boot up the environment: docker compose up -d --build"
echo "=========================================================="
