#!/usr/bin/env bash
# Ultimate Single-File DeepSeek Harness Deployment Script (Automated .env Reader)
set -e

# 1. Target Directory & Path Setup
export DSH_INSTALL="${DSH_INSTALL:-$(pwd)}"
echo "🚀 Setting up DeepSeek Harness at: $DSH_INSTALL"

mkdir -p "$DSH_INSTALL/config/profiles/web" \
         "$DSH_INSTALL/workspaces"

# 2. Strict & Safe Environment Variable Loader
load_env_safely() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading/trailing whitespace
    line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$line" in
      \#*|"") continue ;;
    esac
    # Validate strictly alphanumeric KEY name
    if echo "$line" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*='; then
      local key="${line%%=*}"
      local val="${line#*=}"
      # Strip surrounding quotes safely
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then
        val="${BASH_REMATCH[1]}"
      elif [[ "$val" =~ ^\'(.*)\'$ ]]; then
        val="${BASH_REMATCH[1]}"
      fi
      export "$key=$val"
    fi
  done < "$env_file"
}

if [ -f "$DSH_INSTALL/.env" ]; then
  echo "📝 Loading environment variables from $DSH_INSTALL/.env..."
  load_env_safely "$DSH_INSTALL/.env"
elif [ -f ".env" ]; then
  echo "📝 Copying local .env to $DSH_INSTALL/.env and loading variables..."
  cp .env "$DSH_INSTALL/.env"
  load_env_safely "$DSH_INSTALL/.env"
else
  echo "⚠️  No .env file found in current directory or target folder."
  echo "👉 Please create a .env file with your GEMINI_API_KEY first."
  exit 1
fi

# Copy profile lockfiles if installing to an external directory
if [ "$DSH_INSTALL" != "$(pwd)" ] && [ -d "config/profiles/web" ]; then
  cp -r config/profiles/web/* "$DSH_INSTALL/config/profiles/web/" 2>/dev/null || true
fi

# 3. Write Active Cordis Patch Configuration (Dual Gemini + OpenRouter Native Architecture)
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

# 3. Write Web Profile Plugin Manifest (9 Pre-Packaged Plugins)
cat << 'EOF' > "$DSH_INSTALL/config/profiles/web/package.json"
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@liustack/modsearch": "^5.10.0",
    "dsh-better-sidebar": "^0.17.1",
    "dsh-find-plugin": "^0.3.7",
    "dsh-mcp-market": "^0.1.2",
    "dsh-mcp-panel": "^0.6.2",
    "dsh-mnemon": "^0.4.3",
    "dsh-model-sync": "^0.1.6",
    "dsh-provider-model-configurator": "github:LiangYin233/dsh-provider-model-configurator#70f88112c7d92fadeb93e46f5dcb8b1f3ae6eba3",
    "dshmarket": "^1.39.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dshmarket",
        "@liustack/modsearch",
        "dsh-better-sidebar",
        "dsh-find-plugin",
        "dsh-mcp-panel",
        "dsh-provider-model-configurator",
        "dsh-mnemon",
        "dsh-model-sync",
        "dsh-mcp-market"
      ]
    }
  }
}
EOF

# 4. Write Web Profile MCP Configuration (Pre-configured MCP Servers)
cat << 'EOF' > "$DSH_INSTALL/config/profiles/web/cordis.patch.yml"
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
# --- dsh-mcp-market managed (auto-generated) ---
- insert:
    - id: mcp-fetch
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: fetch
        transport: stdio
        command: npx
        args:
          - '-y'
          - '@mzxrai/mcp-webresearch'
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: stdio
        command: npx
        args:
          - '-y'
          - '@upstash/context7-mcp'
- insert:
    - id: mcp-github
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: stdio
        command: npx
        args:
          - '-y'
          - '@modelcontextprotocol/server-github'
# --- end dsh-mcp-market managed ---
EOF

# 5. Write Multi-Stage Dockerfile (pnpm builder + minimal runtime)
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
COPY config/profiles/web/package.json config/profiles/web/pnpm-lock.yaml* config/profiles/web/pnpm-workspace.yaml* ./

RUN pnpm config set minimum-release-age 0 \
    && pnpm install \
    && pnpm approve-builds --all || true \
    && pnpm prune --prod \
    && rm -rf /root/.cache /root/.npm

# ── Stage 2: Minimal Production Runtime ───────────────────────────
FROM smanx/deepseek-harness:latest AS runner

# Retain pnpm for on-the-fly dynamic Web UI plugin installations
RUN npm install -g pnpm && npm cache clean --force

# Patch pi-ai to preserve Google AI Studio thought_signature / extra_content on tool calls
RUN node -e '\
const fs = require("fs");\
const file = "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";\
if (fs.existsSync(file)) {\
  let content = fs.readFileSync(file, "utf8");\
  if (!content.includes("const googleExtraContentCache")) {\
    content = "const googleExtraContentCache = new Map();\\n" + content;\
    content = content.replace("const name = toolCall.function?.name ?? toolCall.custom?.name;", "if (toolCall.extra_content) { block.extra_content = toolCall.extra_content; if (toolCall.id || block.id) { googleExtraContentCache.set(toolCall.id || block.id, toolCall.extra_content); } }\\n                            const name = toolCall.function?.name ?? toolCall.custom?.name;");\
    content = content.replace("return {\\n                        id: tc.id,", "const extra = tc.extra_content || googleExtraContentCache.get(tc.id);\\n                    return {\\n                        ...(extra ? { extra_content: extra } : {}),\\n                        id: tc.id,");\
    fs.writeFileSync(file, content, "utf8");\
  }\
}'

# Patch entrypoint.sh to automatically synchronize models on container boot
RUN node -e '\
const fs = require("fs");\
const file = "/app/entrypoint.sh";\
if (fs.existsSync(file)) {\
  let content = fs.readFileSync(file, "utf8");\
  if (!content.includes("sync_models.mjs")) {\
    const syncHook = "# ── 2.8 动态多模型自动同步 ──\\nif [ -f /root/.dsh/sync_models.mjs ]; then\\n  echo \"[dsh] 自动同步多提供商模型 (OpenRouter & Google AI Studio) ...\"\\n  (node /root/.dsh/sync_models.mjs || true) &\\nfi\\n\\n";\
    content = content.replace("echo \"[proxy] 启动代理", syncHook + "echo \"[proxy] 启动代理");\
    fs.writeFileSync(file, content, "utf8");\
  }\
}'

# Copy pre-compiled and pre-built plugins
COPY --from=builder /root/.dsh/profiles/web /root/.dsh/profiles/web
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /root/.dsh/profiles/web/

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
      - GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN:-}
      - GITHUB_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN:-}
      - DSH_TELEMETRY_MODE=FULL
      - DSH_TELEMETRY_OTLP_URL=http://phoenix:6006/v1/traces
      - PHOENIX_API_KEY=${PHOENIX_API_KEY:-}
    depends_on:
      - phoenix
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  phoenix:
    image: arizephoenix/phoenix:latest
    container_name: dsh-phoenix
    restart: unless-stopped
    ports:
      - "6006:6006"
    environment:
      - PHOENIX_PORT=6006
      - PHOENIX_GRPC_PORT=4317
      - PHOENIX_API_KEY=${PHOENIX_API_KEY:-}
      - GOOGLE_API_KEY=${GEMINI_API_KEY:-}
      - GEMINI_API_KEY=${GEMINI_API_KEY:-}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-${OPENROUTER_API_KEY:-}}
      - OPENAI_BASE_URL=${OPENAI_BASE_URL:-https://openrouter.ai/api/v1}
      - OPENAI_API_BASE=${OPENAI_API_BASE:-https://openrouter.ai/api/v1}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
    volumes:
      - ./config/phoenix:/root/.phoenix
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF

echo "=========================================================="
echo "✅ Architecture built cleanly at: $DSH_INSTALL"
echo "🛠️  Execution Steps:"
if [ "$DSH_INSTALL" != "$(pwd)" ]; then
  echo "  1. Navigate to your installation folder: cd $DSH_INSTALL"
  echo "  2. Build & boot up the environment: docker compose up -d --build"
else
  echo "  1. Build & boot up the environment: docker compose up -d --build"
fi
echo "=========================================================="
