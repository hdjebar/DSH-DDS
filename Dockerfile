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

# Copy pre-compiled and pre-built plugins
COPY --from=builder /root/.dsh/profiles/web /root/.dsh/profiles/web
COPY config/profiles/web/cordis.patch.yml* config/profiles/web/cordis.yml* /root/.dsh/profiles/web/

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/').then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
