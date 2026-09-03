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
    echo "⬇️  Downloading $rel_path from repository..."
    if ! curl -fsSL "$GITHUB_RAW/$rel_path" -o "$dest"; then
      echo "❌ Error: Failed to download $rel_path from $GITHUB_RAW/$rel_path" >&2
      exit 1
    fi
  fi
}

# Provision essential runtime scripts, personas, templates, and CLI tools
echo "📦 Provisioning runtime engines, personas, and diagnostic tools..."
fetch_or_copy_file "config/sync_models.mjs"
fetch_or_copy_file "config/doctor.mjs"
fetch_or_copy_file "config/persona.mjs"
fetch_or_copy_file "config/patch_translations.mjs"
fetch_or_copy_file "config/patch-pi-ai.mjs"
fetch_or_copy_file "config/patch-bash-local.mjs"
fetch_or_copy_file "config/settings.default.yaml"
if [ ! -f "$DSH_INSTALL/config/settings.yaml" ] && [ -f "$DSH_INSTALL/config/settings.default.yaml" ]; then
  cp "$DSH_INSTALL/config/settings.default.yaml" "$DSH_INSTALL/config/settings.yaml"
fi
fetch_or_copy_file "dsh.sh"
fetch_or_copy_file "reset.sh"
fetch_or_copy_file "docker-compose.sandbox.yml"
fetch_or_copy_file "docker/entrypoint.sh"

# Profiles
fetch_or_copy_file "config/profiles/web/pnpm-lock.yaml"
fetch_or_copy_file "config/profiles/web/pnpm-workspace.yaml"
fetch_or_copy_file "config/profiles/web/cordis.yml"
fetch_or_copy_file "config/profiles/cli/pnpm-lock.yaml"
fetch_or_copy_file "config/profiles/cli/package.json"
fetch_or_copy_file "config/profiles/cli/cordis.yml"
fetch_or_copy_file "config/profiles/headless/package.json"
fetch_or_copy_file "config/profiles/headless/cordis.yml"
fetch_or_copy_file "config/profiles/headless/cordis.patch.yml"
fetch_or_copy_file "config/profiles/headless/pnpm-workspace.yaml"

# Personas (all 7 domain packages - 100% Declarative Architecture)
fetch_or_copy_file "config/personas/sdmx-expert/persona.yaml"
fetch_or_copy_file "config/personas/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/personas/data-analyst/persona.yaml"
fetch_or_copy_file "config/personas/data-analyst/SKILL.md"
fetch_or_copy_file "config/personas/devops-sre/persona.yaml"
fetch_or_copy_file "config/personas/devops-sre/SKILL.md"
fetch_or_copy_file "config/personas/mlops-engineer/persona.yaml"
fetch_or_copy_file "config/personas/mlops-engineer/SKILL.md"
fetch_or_copy_file "config/personas/persona-creator/persona.yaml"
fetch_or_copy_file "config/personas/persona-creator/SKILL.md"
fetch_or_copy_file "config/personas/security-auditor/persona.yaml"
fetch_or_copy_file "config/personas/security-auditor/SKILL.md"
fetch_or_copy_file "config/personas/stats-engineer/persona.yaml"
fetch_or_copy_file "config/personas/stats-engineer/SKILL.md"

# Skills (all 7 domain skills)
fetch_or_copy_file "config/skills/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/skills/data-analyst/SKILL.md"
fetch_or_copy_file "config/skills/devops-sre/SKILL.md"
fetch_or_copy_file "config/skills/mlops-engineer/SKILL.md"
fetch_or_copy_file "config/skills/persona-creator/SKILL.md"
fetch_or_copy_file "config/skills/security-auditor/SKILL.md"
fetch_or_copy_file "config/skills/stats-engineer/SKILL.md"

# Templates
fetch_or_copy_file "config/templates/personas/base-template/persona.yaml"
fetch_or_copy_file "config/templates/personas/base-template/SKILL.md"
fetch_or_copy_file "config/templates/personas/sdmx-expert/persona.yaml"
fetch_or_copy_file "config/templates/personas/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/templates/personas/data-analyst/persona.yaml"
fetch_or_copy_file "config/templates/personas/data-analyst/SKILL.md"
fetch_or_copy_file "config/templates/personas/devops-sre/persona.yaml"
fetch_or_copy_file "config/templates/personas/devops-sre/SKILL.md"
fetch_or_copy_file "config/templates/personas/persona-creator/persona.yaml"
fetch_or_copy_file "config/templates/personas/persona-creator/SKILL.md"
fetch_or_copy_file "config/templates/personas/security-auditor/persona.yaml"
fetch_or_copy_file "config/templates/personas/security-auditor/SKILL.md"

# Permissions
chmod +x "$DSH_INSTALL/dsh.sh" 2>/dev/null || true
chmod +x "$DSH_INSTALL/reset.sh" 2>/dev/null || true
chmod +x "$DSH_INSTALL/docker/entrypoint.sh" 2>/dev/null || true

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
- insert:
    - id: mcp-sqlite-db
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: sqlite-db
        transport: stdio
        command: mcp-server-sqlite
        args:
          - --db-path
          - /workspaces/data.db
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

# Pre-install pnpm, yaml parser, python3, and all MCP servers globally for zero-network runtime execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    && npm install -g pnpm yaml@2.7.0 @mzxrai/mcp-webresearch@0.1.7 @upstash/context7-mcp@1.0.14 \
    && npm cache clean --force \
    && /usr/local/lib/node_modules/@mzxrai/mcp-webresearch/node_modules/.bin/playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && uv tool install --with 'mcp<2.0.0' mcp-server-sqlite@2025.4.25 \
    && ln -sf /root/.local/bin/mcp-server-sqlite /usr/local/bin/mcp-server-sqlite

ENV PATH="/root/.local/bin:${PATH}"
ENV NODE_PATH="/usr/local/lib/node_modules:/app/prebuilt-profiles/web/node_modules:/root/.dsh/profiles/web/node_modules:/root/.dsh/profiles/node_modules"

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

# Build-Time Immutability: Patch dsh-bash-local to auto-create spec.workdir before spawning under Landlock
COPY config/patch-bash-local.mjs /usr/local/bin/patch-bash-local.mjs
RUN node /usr/local/bin/patch-bash-local.mjs \
    && node --check /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-bash-local/lib/index.js

# Preserve the upstream launcher and install the repository-owned bootstrap wrapper.
RUN mkdir -p /root/.mnemon/runtime /root/.dsh/profiles/web /root/.dsh/profiles/node_modules \
    /root/.dsh/storages /root/.dsh/sessions /root/.dsh/patch /run/dsh /workspaces \
    /opt/dsh-config /var/lib/dsh-state \
    && mv /app/entrypoint.sh /app/entrypoint.upstream.sh \
    && sed -i 's|#!/usr/bin/env node|#!/usr/bin/env -S node --expose-internals|g' /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
    && ln -sf ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh

COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint \
    && sh -n /usr/local/bin/dsh-entrypoint \
    && sh -n /app/entrypoint.upstream.sh

# Copy pre-compiled and pre-built plugins to both internal cache and default profile location
COPY --from=builder /root/.dsh/profiles/web /app/prebuilt-profiles/web
COPY --from=builder /root/.dsh/profiles/web /root/.dsh/profiles/web
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /app/prebuilt-profiles/web/
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /root/.dsh/profiles/web/

# Complete profile peer dependencies from DSH's pinned runtime dependency tree.
RUN for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/*; do \
      [ -e "$p" ] && [ ! -e "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" ] \
        && ln -s "$p" "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" || true; \
    done && \
    for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@*/*; do \
      if [ -e "$p" ]; then \
        scope="$(basename "$(dirname "$p")")"; \
        mkdir -p "/app/prebuilt-profiles/web/node_modules/$scope"; \
        [ -e "/app/prebuilt-profiles/web/node_modules/$scope/$(basename "$p")" ] \
          || ln -s "$p" "/app/prebuilt-profiles/web/node_modules/$scope/$(basename "$p")"; \
      fi; \
    done

# Link profile node_modules globally into /usr/local/lib/node_modules and /app/node_modules.
RUN for p in /root/.dsh/profiles/web/node_modules/*; do [ -e "$p" ] && ln -sf "$p" "/usr/local/lib/node_modules/$(basename "$p")" || true; done && \
    for p in /root/.dsh/profiles/web/node_modules/@*/*; do [ -e "$p" ] && mkdir -p "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)" && ln -sf "$p" "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)/$(basename "$p")" || true; done && \
    ln -sf /root/.dsh/profiles/web/node_modules /app/node_modules

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/dsh-entrypoint"]
EOF

# 6. Write Production Docker Compose Layout with localhost port bindings and sanitized telemetry
cat << 'EOF' > "$DSH_INSTALL/docker-compose.yml"
services:
  dsh:
    build: .
    image: dsh-local:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:${DSH_PORT:-3080}:3080"
    volumes:
      - ./config:/root/.dsh
      - ./workspaces:/workspaces
    environment:
      - PORT=3080
      - NODE_ENV=production
      - NODE_PATH=/usr/local/lib/node_modules:/app/prebuilt-profiles/web/node_modules:/root/.dsh/profiles/web/node_modules:/root/.dsh/profiles/node_modules
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
      - GEMINI_API_KEY=${GEMINI_API_KEY:-}
      - GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN:-}
      - GITHUB_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN:-}
      - DSH_TELEMETRY_MODE=FULL
      - DSH_TELEMETRY_OTLP_URL=http://phoenix:6006/v1/traces
      - PHOENIX_API_KEY=${PHOENIX_API_KEY:-}
      - PHOENIX_SECRET=${PHOENIX_SECRET:-}
    depends_on:
      phoenix:
        condition: service_healthy
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  phoenix:
    image: arizephoenix/phoenix:20.5.0@sha256:39374ee6ad0c69c0a5e713e42e869f70ae99f681e0dbad374721a5ccecd0d54d
    restart: unless-stopped
    ports:
      - "127.0.0.1:6006:6006"
    command:
      - "-c"
      - "import os, sys; os.environ.pop('PHOENIX_SECRET', None) if not os.environ.get('PHOENIX_SECRET') else None; from phoenix.server.main import main; sys.argv = ['phoenix', 'serve']; main()"
    healthcheck:
      test: ["CMD", "/usr/bin/python3.13", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6006/')"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
    environment:
      - PHOENIX_PORT=6006
      - PHOENIX_GRPC_PORT=4317
      - PHOENIX_API_KEY=${PHOENIX_API_KEY:-}
      - PHOENIX_SECRET=${PHOENIX_SECRET:-}
      - PHOENIX_ENABLE_AUTH=${PHOENIX_ENABLE_AUTH:-false}
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
