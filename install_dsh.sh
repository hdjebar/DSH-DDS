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
  chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
  echo "📝 Loading environment variables from $DSH_INSTALL/.env..."
  load_env_safely "$DSH_INSTALL/.env"
elif [ -f ".env" ]; then
  echo "📝 Copying local .env to $DSH_INSTALL/.env and loading variables..."
  cp .env "$DSH_INSTALL/.env"
  chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
  load_env_safely "$DSH_INSTALL/.env"
else
  echo "⚙️  No .env file found. Setting up new configuration..."
  if [ -t 0 ]; then
    echo "🔑 Please enter your API keys (hidden input, or press Enter to skip and populate later):"
    read -srp "  • Google Gemini API Key [GEMINI_API_KEY]: " input_gemini
    echo ""
    read -srp "  • OpenRouter API Key [OPENROUTER_API_KEY]: " input_openrouter
    echo ""
    read -srp "  • GitHub Personal Access Token [GITHUB_PERSONAL_ACCESS_TOKEN]: " input_github
    echo ""
    read -rp "  • DSH Web Port [default 3080]: " input_port
    
    cat << EOF > "$DSH_INSTALL/.env"
# DeepSeek Harness + Arize Phoenix Environment Configuration
DSH_PORT=${input_port:-3080}
GEMINI_API_KEY=${input_gemini:-}
OPENROUTER_API_KEY=${input_openrouter:-}
GITHUB_PERSONAL_ACCESS_TOKEN=${input_github:-}
PHOENIX_API_KEY=
EOF
    chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
    echo "✅ Generated $DSH_INSTALL/.env (mode 0600)"
    load_env_safely "$DSH_INSTALL/.env"
  else
    cat << 'EOF' > "$DSH_INSTALL/.env"
# DeepSeek Harness + Arize Phoenix Environment Configuration
DSH_PORT=3080
GEMINI_API_KEY=
OPENROUTER_API_KEY=
GITHUB_PERSONAL_ACCESS_TOKEN=
PHOENIX_API_KEY=
EOF
    chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
    echo "📝 Generated starter $DSH_INSTALL/.env template (mode 0600). You can populate keys anytime in .env."
    load_env_safely "$DSH_INSTALL/.env"
  fi
fi

GITHUB_RAW="https://raw.githubusercontent.com/hdjebar/DSH-DDS/main"

fetch_or_copy_file() {
  local rel_path="$1"
  local dest="$DSH_INSTALL/$rel_path"
  if [ -f "$dest" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  if [ -f "$rel_path" ]; then
    cp "$rel_path" "$dest"
  else
    echo "⬇️  Downloading $rel_path from repository..."
    curl -fsSL "$GITHUB_RAW/$rel_path" -o "$dest" 2>/dev/null || true
  fi
}

# Provision essential runtime scripts, personas, templates, and CLI tools
echo "📦 Provisioning runtime engines, personas, and diagnostic tools..."
fetch_or_copy_file "config/sync_models.mjs"
fetch_or_copy_file "config/doctor.mjs"
fetch_or_copy_file "config/persona.mjs"
fetch_or_copy_file "config/patch_translations.mjs"
fetch_or_copy_file "config/personas/sdmx-expert/persona.yaml"
fetch_or_copy_file "config/personas/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/personas/sdmx-expert/workflow.sh"
fetch_or_copy_file "config/personas/data-analyst/persona.yaml"
fetch_or_copy_file "config/personas/data-analyst/SKILL.md"
fetch_or_copy_file "config/personas/data-analyst/workflow.sh"
fetch_or_copy_file "config/templates/personas/base-template/persona.yaml"
fetch_or_copy_file "config/templates/personas/base-template/SKILL.md"
fetch_or_copy_file "config/templates/personas/base-template/workflow.sh"
fetch_or_copy_file "config/templates/personas/data-analyst/persona.yaml"
fetch_or_copy_file "config/templates/personas/data-analyst/SKILL.md"
fetch_or_copy_file "config/templates/personas/data-analyst/workflow.sh"
fetch_or_copy_file "config/skills/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/skills/data-analyst/SKILL.md"
fetch_or_copy_file "dsh.sh"
fetch_or_copy_file "docker-compose.sandbox.yml"

if [ -f "$DSH_INSTALL/dsh.sh" ]; then
  chmod +x "$DSH_INSTALL/dsh.sh"
fi
if [ -f "$DSH_INSTALL/config/personas/sdmx-expert/workflow.sh" ]; then
  chmod +x "$DSH_INSTALL/config/personas/sdmx-expert/workflow.sh"
fi
if [ -f "$DSH_INSTALL/config/personas/data-analyst/workflow.sh" ]; then
  chmod +x "$DSH_INSTALL/config/personas/data-analyst/workflow.sh"
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

# 3. Write Web Profile Plugin Manifest (10 Pre-Packaged Plugins)
cat << 'EOF' > "$DSH_INSTALL/config/profiles/web/package.json"
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@liustack/modsearch": "^5.10.0",
    "deepseek-flow": "^0.4.0",
    "dsh-find-plugin": "^0.3.7",
    "dsh-mcp-market": "^0.1.2",
    "dsh-mcp-panel": "^0.6.3",
    "dsh-mnemon": "^0.4.4",
    "dsh-model-sync": "^0.1.6",
    "dsh-provider-model-configurator": "github:LiangYin233/dsh-provider-model-configurator#70f88112c7d92fadeb93e46f5dcb8b1f3ae6eba3",
    "dsh-session-reader": "^0.1.0",
    "dshmarket": "^1.39.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@liustack/modsearch",
        "dshmarket",
        "dsh-find-plugin",
        "dsh-mcp-panel",
        "dsh-provider-model-configurator",
        "dsh-mnemon",
        "dsh-model-sync",
        "dsh-mcp-market",
        "dsh-session-reader",
        "deepseek-flow"
      ]
    }
  }
}
EOF

# 4. Write Web Profile MCP Configuration (Pinned MCP Servers)
cat << 'EOF' > "$DSH_INSTALL/config/profiles/web/cordis.patch.yml"
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
# --- dsh-mcp-market managed (auto-generated; do not edit) ---
- insert:
    - id: mcp-fetch
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: fetch
        transport: stdio
        command: mcp-server-webresearch
        args: []
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: stdio
        command: context7-mcp
        args: []
- insert:
    - id: mcp-github
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: stdio
        command: github-mcp-server
        args:
          - stdio
# --- end dsh-mcp-market managed ---
EOF

# 5. Write Multi-Stage Dockerfile (pnpm builder + minimal runtime)
cat << 'EOF' > "$DSH_INSTALL/Dockerfile"
# ── Stage 1: Multi-Stage Builder with pnpm ───────────────────────
FROM smanx/deepseek-harness:0.1.1-rc.2@sha256:cab4bba47e6200c17fcd008d08f1ba39ad23c540991df98621ac2029332e9618 AS builder

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
    && (pnpm approve-builds --all || true) \
    && pnpm prune --prod \
    && rm -rf /root/.cache /root/.npm

# ── Stage 2: Minimal Production Runtime ───────────────────────────
FROM smanx/deepseek-harness:0.1.1-rc.2@sha256:cab4bba47e6200c17fcd008d08f1ba39ad23c540991df98621ac2029332e9618 AS runner

# Copy static Astral uv and uvx binaries for lightweight Python MCP execution
COPY --from=ghcr.io/astral-sh/uv:0.6.5@sha256:562193a4a9d398f8aedddcb223e583da394ee735de36b5815f8f1d22cb49be15 /uv /uvx /bin/

# Copy official maintained GitHub MCP server binary
COPY --from=ghcr.io/github/github-mcp-server:v1.11.0@sha256:fbec75de11c255213fa08d80fb166abe73d851fff631c51c0079872967720699 /server/github-mcp-server /usr/local/bin/github-mcp-server

# Pre-install pnpm, python3, and all MCP servers globally for zero-network runtime execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    && npm install -g pnpm @mzxrai/mcp-webresearch@0.1.7 @upstash/context7-mcp@1.0.14 \
    && npm cache clean --force \
    && /usr/local/lib/node_modules/@mzxrai/mcp-webresearch/node_modules/.bin/playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && uv tool install mcp-server-sqlite@2025.4.25 \
    && ln -sf /root/.local/bin/mcp-server-sqlite /usr/local/bin/mcp-server-sqlite

ENV PATH="/root/.local/bin:${PATH}"

# Patch pi-ai to preserve Google AI Studio thought_signature / extra_content on tool calls
RUN node -e '\
const fs = require("fs");\
const file = "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";\
if (fs.existsSync(file)) {\
  let content = fs.readFileSync(file, "utf8");\
  if (!content.includes("googleExtraContentCache")) {\
    const anchor1 = "const name = toolCall.function?.name ?? toolCall.custom?.name;";\
    const anchor2 = "return {\n                        id: tc.id,";\
    if (!content.includes(anchor1)) throw new Error("pi-ai anchor1 missing");\
    if (!content.includes(anchor2)) throw new Error("pi-ai anchor2 missing");\
    content = "const googleExtraContentCache = new Map();\n" + content;\
    content = content.replace(anchor1, "if (toolCall.extra_content) { block.extra_content = toolCall.extra_content; if (toolCall.id || block.id) { googleExtraContentCache.set(toolCall.id || block.id, toolCall.extra_content); } }\n                            " + anchor1);\
    content = content.replace(anchor2, "const extra = tc.extra_content || googleExtraContentCache.get(tc.id);\n                    return {\n                        ...(extra ? { extra_content: extra } : {}),\n                        id: tc.id,");\
    fs.writeFileSync(file, content, "utf8");\
    console.log("✅ pi-ai thought signature bridge applied successfully.");\
  }\
}' && node --check /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js

# Patch entrypoint.sh to seed prebuilt dependencies and synchronize models on container boot
RUN node -e '\
const fs = require("fs");\
const file = "/app/entrypoint.sh";\
if (fs.existsSync(file)) {\
  let content = fs.readFileSync(file, "utf8");\
  if (!content.includes("sync_models.mjs")) {\
    const syncHook = `# ── 2.7 Seed Pre-built Profile Dependencies ──\nif [ ! -d "/root/.dsh/profiles/web/node_modules" ] && [ -d "/app/prebuilt-profiles/web/node_modules" ]; then\n  echo "[dsh] Seeding pre-built web profile dependencies..."\n  mkdir -p /root/.dsh/profiles/web\n  cp -rn /app/prebuilt-profiles/web/node_modules /root/.dsh/profiles/web/ 2>/dev/null || true\nfi\n\n# ── 2.8 Automated Multi-Provider Model Synchronization ──\nif [ -f /root/.dsh/sync_models.mjs ]; then\n  echo "[dsh] Auto-synchronizing multi-provider models (OpenRouter & Google AI Studio)..."\n  (node /root/.dsh/sync_models.mjs || true) &\nfi\n\n`;\
    const anchor = "echo \"[proxy] 启动代理";\
    if (!content.includes(anchor)) {\
      content = syncHook + content;\
    } else {\
      content = content.replace(anchor, syncHook + anchor);\
    }\
    fs.writeFileSync(file, content, "utf8");\
    console.log("✅ entrypoint startup hooks applied successfully.");\
  }\
}' && bash -n /app/entrypoint.sh

# Copy pre-compiled and pre-built plugins to both internal cache and default profile location
COPY --from=builder /root/.dsh/profiles/web /app/prebuilt-profiles/web
COPY --from=builder /root/.dsh/profiles/web /root/.dsh/profiles/web
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /root/.dsh/profiles/web/

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
EOF

# 6. Write Production Docker Compose Layout with localhost port bindings and sanitized telemetry
cat << 'EOF' > "$DSH_INSTALL/docker-compose.yml"
services:
  dsh:
    build: .
    image: dsh-local:latest
    container_name: dsh-local
    restart: unless-stopped
    ports:
      - "127.0.0.1:${DSH_PORT:-3080}:3080"
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
    image: arizephoenix/phoenix:20.5.0@sha256:39374ee6ad0c69c0a5e713e42e869f70ae99f681e0dbad374721a5ccecd0d54d
    container_name: dsh-phoenix
    restart: unless-stopped
    ports:
      - "127.0.0.1:6006:6006"
    environment:
      - PHOENIX_PORT=6006
      - PHOENIX_GRPC_PORT=4317
      - PHOENIX_API_KEY=${PHOENIX_API_KEY:-}
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
