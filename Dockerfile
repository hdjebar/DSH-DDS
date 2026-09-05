# ── Stage 1: Multi-Stage Builder with pnpm ───────────────────────
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential \
    && npm install -g pnpm@11.25.0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /root/.dsh/profiles/web
COPY config/profiles/web/package.json config/profiles/web/pnpm-lock.yaml* config/profiles/web/pnpm-workspace.yaml* ./

RUN pnpm config set minimum-release-age 0 \
    && pnpm install \
    && (pnpm approve-builds --all || true) \
    && pnpm prune --prod \
    && rm -rf /root/.cache /root/.npm

# ── Stage 2: Hardened Minimal Production Runtime ───────────────────
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runner

# Copy static Astral uv and uvx binaries for lightweight Python MCP execution
COPY --from=ghcr.io/astral-sh/uv:0.6.5@sha256:562193a4a9d398f8aedddcb223e583da394ee735de36b5815f8f1d22cb49be15 /uv /uvx /bin/

# Copy official maintained GitHub MCP server binary
COPY --from=ghcr.io/github/github-mcp-server:v1.11.0@sha256:fbec75de11c255213fa08d80fb166abe73d851fff631c51c0079872967720699 /server/github-mcp-server /usr/local/bin/github-mcp-server

# Install official DeepSeek Harness engine and MCP tools globally
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    curl \
    && npm install -g @deepseek-ai/dsh@0.1.2-rc.1 pnpm@11.25.0 yaml@2.7.0 playwright@1.49.0 @mzxrai/mcp-webresearch@0.1.7 @upstash/context7-mcp@1.0.14 \
    && npm cache clean --force \
    && playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && uv tool install --with 'mcp<2.0.0' mcp-server-sqlite@2025.4.25 \
    && ln -sf /root/.local/bin/mcp-server-sqlite /usr/local/bin/mcp-server-sqlite

ENV PATH="/root/.local/bin:${PATH}"
ENV NODE_PATH="/usr/local/lib/node_modules:/app/prebuilt-profiles/web/node_modules:/root/.dsh/profiles/web/node_modules:/root/.dsh/profiles/node_modules"

# Patch pi-ai to preserve Google AI Studio thought_signature / extra_content on tool calls
RUN node -e '\
const fs = require("fs");\
const path = require("path");\
function findPiAi(dir) {\
  if (!fs.existsSync(dir)) return null;\
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\
    const full = path.join(dir, entry.name);\
    if (entry.isDirectory()) {\
      if (entry.name === "@earendil-works") {\
        const target = path.join(full, "pi-ai/dist/api/openai-completions.js");\
        if (fs.existsSync(target)) return target;\
      }\
      const sub = findPiAi(full);\
      if (sub) return sub;\
    }\
  }\
  return null;\
}\
const candidates = [\
  "/usr/local/lib/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js",\
  "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js",\
  "/usr/local/lib/node_modules/@deepseek-ai/dsh-llm-pi-ai/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js"\
];\
const file = candidates.find(p => fs.existsSync(p)) || findPiAi("/usr/local/lib/node_modules");\
if (file && fs.existsSync(file)) {\
  let content = fs.readFileSync(file, "utf8");\
  if (!content.includes("googleExtraContentCache")) {\
    const anchor1 = "const name = toolCall.function?.name ?? toolCall.custom?.name;";\
    const anchor2 = "return {\n                        id: tc.id,";\
    if (!content.includes(anchor1)) throw new Error("pi-ai anchor1 missing in " + file);\
    if (!content.includes(anchor2)) throw new Error("pi-ai anchor2 missing in " + file);\
    content = "const googleExtraContentCache = new Map();\n" + content;\
    content = content.replace(anchor1, "if (toolCall.extra_content) { block.extra_content = toolCall.extra_content; if (toolCall.id || block.id) { googleExtraContentCache.set(toolCall.id || block.id, toolCall.extra_content); } }\n                            " + anchor1);\
    content = content.replace(anchor2, "const extra = tc.extra_content || googleExtraContentCache.get(tc.id);\n                    return {\n                        ...(extra ? { extra_content: extra } : {}),\n                        id: tc.id,");\
    fs.writeFileSync(file, content, "utf8");\
    console.log("✅ pi-ai thought signature bridge applied successfully to " + file);\
  }\
  nodeCheck = require("child_process").execSync("node --check " + file);\
} else {\
  console.log("ℹ️ pi-ai module not present in installation; skipping patch.");\
}'

# Build-Time Immutability: Patch dsh-bash-local to auto-create spec.workdir before spawning under Landlock
COPY config/patch-bash-local.mjs /usr/local/bin/patch-bash-local.mjs
RUN node /usr/local/bin/patch-bash-local.mjs

# Build-Time Immutability: Patch dsh-client-connection to eliminate 401 token fence for Web Workbench access
COPY config/patch-client-connection.mjs /usr/local/bin/patch-client-connection.mjs
RUN node /usr/local/bin/patch-client-connection.mjs

# Setup directories, shebang for internals exposure, and global CLI link
RUN mkdir -p /root/.mnemon/runtime /root/.dsh/profiles/web /root/.dsh/profiles/node_modules \
    /root/.dsh/storages /root/.dsh/sessions /root/.dsh/patch /run/dsh /workspaces \
    /opt/dsh-config /var/lib/dsh-state /var/log/dsh /app \
    && chmod 0750 /var/log/dsh \
    && sed -i 's|#!/usr/bin/env node|#!/usr/bin/env -S node --expose-internals|g' /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
    && ln -sf ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh

COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint \
    && sh -n /usr/local/bin/dsh-entrypoint

# Copy pre-compiled and pre-built plugins to both internal cache and default profile location
COPY --from=builder /root/.dsh/profiles/web /app/prebuilt-profiles/web
COPY --from=builder /root/.dsh/profiles/web /root/.dsh/profiles/web
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /app/prebuilt-profiles/web/
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /root/.dsh/profiles/web/

# Complete profile peer dependencies from DSH's runtime dependency tree
RUN for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/* /usr/local/lib/node_modules/@deepseek-ai/*; do \
      [ -e "$p" ] && [ ! -e "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" ] \
        && ln -s "$p" "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" || true; \
    done

# ESM plugins resolve DeepSeek scoped dependencies from their own profile tree.
RUN mkdir -p /app/prebuilt-profiles/web/node_modules/@deepseek-ai && \
    for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/* /usr/local/lib/node_modules/@deepseek-ai/*; do \
      [ -e "$p" ] && ln -sfn "$p" "/app/prebuilt-profiles/web/node_modules/@deepseek-ai/$(basename "$p")"; \
    done

# Link profile node_modules globally into /usr/local/lib/node_modules and /app/node_modules
RUN for p in /root/.dsh/profiles/web/node_modules/*; do [ -e "$p" ] && ln -sf "$p" "/usr/local/lib/node_modules/$(basename "$p")" || true; done && \
    for p in /root/.dsh/profiles/web/node_modules/@*/*; do [ -e "$p" ] && mkdir -p "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)" && ln -sf "$p" "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)/$(basename "$p")" || true; done && \
    ln -sf /root/.dsh/profiles/web/node_modules /app/node_modules

# Patch dsh-model-sync and @deepseek-ai/dsh-settings for settingsNamespace export compatibility
RUN node -e '\
const fs = require("fs");\
const files = [\
  "/app/prebuilt-profiles/web/node_modules/dsh-model-sync/lib/dsh-adapter.js",\
  "/root/.dsh/profiles/web/node_modules/dsh-model-sync/lib/dsh-adapter.js",\
  "/app/prebuilt-profiles/web/node_modules/@deepseek-ai/dsh-settings/lib/index.js",\
  "/root/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-settings/lib/index.js",\
  "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js"\
];\
for (const f of files) {\
  if (fs.existsSync(f)) {\
    let c = fs.readFileSync(f, "utf8");\
    c = c.replace("export { settingsNamespace } from '\''@deepseek-ai/dsh-settings'\'';", "export function settingsNamespace(v) { return v; };");\
    c = c.replace("export { SettingsConflictError, SettingsProvider, SettingsProvider as default, redactSecrets };", "export { SettingsConflictError, SettingsProvider, SettingsProvider as default, redactSecrets, parseSettingsNamespace as settingsNamespace };");\
    fs.writeFileSync(f, c);\
  }\
}'

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/dsh-entrypoint"]
