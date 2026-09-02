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
    && uv tool install mcp-server-sqlite@2025.4.25 \
    && ln -sf /root/.local/bin/mcp-server-sqlite /usr/local/bin/mcp-server-sqlite

ENV PATH="/root/.local/bin:${PATH}"
ENV NODE_PATH="/usr/local/lib/node_modules"

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
    const syncHook = `# ── 2.7 Seed Pre-built Profile Dependencies ──\nif [ -d "/app/prebuilt-profiles/web/node_modules" ]; then\n  echo "[dsh] Seeding pre-built web profile dependencies (including .pnpm & .bin)..."\n  mkdir -p /root/.dsh/profiles/web/node_modules\n  cp -rn /app/prebuilt-profiles/web/node_modules/. /root/.dsh/profiles/web/node_modules/ 2>/dev/null || true\nfi\n\n# ── 2.8 Automated Multi-Provider Model Synchronization ──\nif [ -f /root/.dsh/sync_models.mjs ]; then\n  echo "[dsh] Auto-synchronizing multi-provider models (OpenRouter & Google AI Studio)..."\n  (node /root/.dsh/sync_models.mjs || true) &\nfi\n\n`;\
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
