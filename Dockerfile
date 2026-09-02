# ── Stage 1: Multi-Stage Builder with pnpm ───────────────────────
FROM smanx/deepseek-harness:1.1.0 AS builder

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
FROM smanx/deepseek-harness:1.1.0 AS runner

# Retain pnpm for on-the-fly dynamic Web UI plugin installations
RUN npm install -g pnpm && npm cache clean --force

# Patch pi-ai to preserve Google AI Studio thought_signature / extra_content on tool calls
RUN node -e '\
const fs = require("fs");\
const file = "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js";\
if (fs.existsSync(file)) {\
  let content = fs.readFileSync(file, "utf8");\
  if (!content.includes("const googleExtraContentCache")) {\
    const anchor1 = "const name = toolCall.function?.name ?? toolCall.custom?.name;";\
    const anchor2 = "return {\\n                        id: tc.id,";\
    if (!content.includes(anchor1)) throw new Error("pi-ai patch assertion failed: anchor1 not found");\
    content = "const googleExtraContentCache = new Map();\\n" + content;\
    content = content.replace(anchor1, "if (toolCall.extra_content) { block.extra_content = toolCall.extra_content; if (toolCall.id || block.id) { googleExtraContentCache.set(toolCall.id || block.id, toolCall.extra_content); } }\\n                            " + anchor1);\
    content = content.replace(anchor2, "const extra = tc.extra_content || googleExtraContentCache.get(tc.id);\\n                    return {\\n                        ...(extra ? { extra_content: extra } : {}),\\n                        id: tc.id,");\
    fs.writeFileSync(file, content, "utf8");\
    console.log("✅ pi-ai thought signature bridge applied successfully.");\
  }\
}'

# Patch entrypoint.sh to automatically synchronize models on container boot
RUN node -e '\
const fs = require("fs");\
const file = "/app/entrypoint.sh";\
if (fs.existsSync(file)) {\
  let content = fs.readFileSync(file, "utf8");\
  if (!content.includes("sync_models.mjs")) {\
    const syncHook = "# ── 2.8 Automated Multi-Provider Model Synchronization ──\\nif [ -f /root/.dsh/sync_models.mjs ]; then\\n  echo \"[dsh] Auto-synchronizing multi-provider models (OpenRouter & Google AI Studio)...\"\\n  (node /root/.dsh/sync_models.mjs || true) &\\nfi\\n\\n";\
    const anchor = "echo \"[proxy] 启动代理";\
    if (!content.includes(anchor)) {\
      content = syncHook + content;\
    } else {\
      content = content.replace(anchor, syncHook + anchor);\
    }\
    fs.writeFileSync(file, content, "utf8");\
    console.log("✅ entrypoint model synchronization hook applied successfully.");\
  }\
}'

# Copy pre-compiled and pre-built plugins
COPY --from=builder /root/.dsh/profiles/web /root/.dsh/profiles/web
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /root/.dsh/profiles/web/

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
