# ── Stage 1: Multi-Stage Builder with pnpm ───────────────────────
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential \
    && npm install -g pnpm@11.25.0 \
    && rm -rf /var/lib/apt/lists/*

ENV HOME="/home/dsh"
WORKDIR /var/lib/dsh/profiles/web
COPY config/profiles/web/package.json config/profiles/web/pnpm-lock.yaml config/profiles/web/pnpm-workspace.yaml ./

RUN mkdir -p /home/dsh/.local/share/pnpm/store/v11 \
    && pnpm config set minimum-release-age 0 \
    && pnpm config set store-dir /home/dsh/.local/share/pnpm/store/v11 \
    && pnpm install --frozen-lockfile \
    && (pnpm approve-builds node-pty protobufjs sharp || true) \
    && pnpm prune --prod \
    && rm -rf /root/.cache /root/.npm

# ── Stage 2: Hardened Minimal Production Runtime ───────────────────
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runner

# Copy static Astral uv and uvx binaries for lightweight Python MCP execution
COPY --from=ghcr.io/astral-sh/uv:0.6.5@sha256:562193a4a9d398f8aedddcb223e583da394ee735de36b5815f8f1d22cb49be15 /uv /uvx /bin/

# Copy official maintained GitHub MCP server binary
COPY --from=ghcr.io/github/github-mcp-server:v1.11.0@sha256:fbec75de11c255213fa08d80fb166abe73d851fff631c51c0079872967720699 /server/github-mcp-server /usr/local/bin/github-mcp-server

# ── Create unprivileged service user dsh (UID/GID 1000) ────────────
RUN usermod -l dsh -d /home/dsh -m node \
    && groupmod -n dsh node \
    && mkdir -p /home/dsh/.local/bin /var/lib/dsh /var/lib/dsh-state /app /run/dsh /var/log/dsh /etc/dsh /opt/uv-tools \
    && chown -R dsh:dsh /home/dsh /var/lib/dsh /var/lib/dsh-state /app /run/dsh /var/log/dsh /etc/dsh /opt/uv-tools

# Install official DeepSeek Harness engine and minimal runtime dependencies (no build compilers, no GUI bloat)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && npm install -g @deepseek-ai/dsh@0.1.2-rc.1 pnpm@11.25.0 yaml@2.7.0 @mzxrai/mcp-webresearch@0.1.7 @upstash/context7-mcp@1.0.14 \
    && npm cache clean --force \
    && UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --with 'mcp<2.0.0' mcp-server-sqlite@2025.4.25 \
    && ln -sf /usr/local/bin/mcp-server-sqlite /home/dsh/.local/bin/mcp-server-sqlite \
    && apt-get purge -y --auto-remove make g++ \
    && rm -rf /var/lib/apt/lists/* /root/.cache /root/.npm \
    && chmod -R 755 /usr/local/bin /usr/local/lib/node_modules /opt/uv-tools

ENV HOME="/home/dsh"
ENV PATH="/home/dsh/.local/bin:/usr/local/bin:${PATH}"
ENV DSH_HOME="/var/lib/dsh"
ENV DSH_CONFIG_DIR="/etc/dsh"
ENV NODE_PATH="/usr/local/lib/node_modules:/app/prebuilt-profiles/web/node_modules:/var/lib/dsh/profiles/web/node_modules:/root/.dsh/profiles/web/node_modules:/root/.dsh/profiles/node_modules"

# Setup directories, shebang for internals exposure, and global CLI link
RUN mkdir -p /home/dsh/.mnemon/runtime /var/lib/dsh/profiles/web /var/lib/dsh/profiles/node_modules \
    /var/lib/dsh/storages /var/lib/dsh/sessions /var/lib/dsh/patch /var/lib/dsh/cache /run/dsh /workspaces \
    /opt/dsh-config /var/lib/dsh-state/sessions /var/lib/dsh-state/storages /var/log/dsh /app /etc/dsh \
    && chmod 0750 /var/log/dsh \
    && ln -sf ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh \
    && ln -sf ../lib/node_modules/@deepseek-ai/dsh/node_modules/.bin/cordis /usr/local/bin/cordis \
    && ln -sf /var/lib/dsh /home/dsh/.dsh \
    && ln -sf /var/lib/dsh /root/.dsh

COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint \
    && sh -n /usr/local/bin/dsh-entrypoint

# Copy pre-compiled and pre-built plugins to both internal cache and default profile location
COPY --from=builder /home/dsh/.local/share/pnpm/store /home/dsh/.local/share/pnpm/store
COPY --from=builder /var/lib/dsh/profiles/web /app/prebuilt-profiles/web
COPY --from=builder /var/lib/dsh/profiles/web /var/lib/dsh/profiles/web
COPY config/cordis.patch.yml /var/lib/dsh/cordis.patch.yml
COPY config/cordis.patch.yml /opt/dsh-config/cordis.patch.yml
COPY config/cordis.patch.yml /etc/dsh/cordis.patch.yml
COPY config/profiles/web/cordis.patch.yml /app/prebuilt-profiles/web/cordis.patch.yml
COPY config/profiles/web/cordis.patch.yml /var/lib/dsh/profiles/web/cordis.patch.yml
COPY config/profiles/headless/cordis.patch.yml /app/prebuilt-profiles/headless/cordis.patch.yml
COPY config/profiles/headless/cordis.patch.yml /var/lib/dsh/profiles/headless/cordis.patch.yml
COPY config/profiles/cli/cordis.yml /app/prebuilt-profiles/cli/cordis.yml
COPY config/profiles/cli/cordis.yml /var/lib/dsh/profiles/cli/cordis.yml

# Complete profile peer dependencies from DSH's runtime dependency tree (never symlink scope dirs)
RUN for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/* /usr/local/lib/node_modules/@deepseek-ai/*; do \
      case "$(basename "$p")" in \
        @*) \
          mkdir -p "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")"; \
          for sub in "$p"/*; do \
            [ -e "$sub" ] && [ ! -e "/app/prebuilt-profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" ] \
              && ln -s "$sub" "/app/prebuilt-profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" || true; \
            [ -e "$sub" ] && [ ! -e "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" ] \
              && ln -s "$sub" "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" || true; \
          done ;; \
        *) \
          [ -e "$p" ] && [ ! -e "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" ] \
            && ln -s "$p" "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" || true; \
          [ -e "$p" ] && [ ! -e "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")" ] \
            && ln -s "$p" "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")" || true; ;; \
      esac; \
    done

# ESM plugins resolve DeepSeek scoped dependencies from their own profile tree.
RUN mkdir -p /app/prebuilt-profiles/web/node_modules/@deepseek-ai /var/lib/dsh/profiles/web/node_modules/@deepseek-ai && \
    for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/* /usr/local/lib/node_modules/@deepseek-ai/*; do \
      [ -e "$p" ] && ln -sfn "$p" "/app/prebuilt-profiles/web/node_modules/@deepseek-ai/$(basename "$p")" && \
      ln -sfn "$p" "/var/lib/dsh/profiles/web/node_modules/@deepseek-ai/$(basename "$p")"; \
    done

# Link profile node_modules globally into /usr/local/lib/node_modules and /app/node_modules
RUN for p in /var/lib/dsh/profiles/web/node_modules/*; do [ -e "$p" ] && ln -sf "$p" "/usr/local/lib/node_modules/$(basename "$p")" || true; done && \
    for p in /var/lib/dsh/profiles/web/node_modules/@*/*; do [ -e "$p" ] && mkdir -p "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)" && ln -sf "$p" "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)/$(basename "$p")" || true; done && \
    ln -sf /var/lib/dsh/profiles/web/node_modules /app/node_modules

# Copy and link native in-tree @dsh-dds/core Cordis plugin
COPY packages/dsh-dds-core /app/packages/dsh-dds-core
RUN mkdir -p /usr/local/lib/node_modules/@dsh-dds /app/prebuilt-profiles/web/node_modules/@dsh-dds /var/lib/dsh/profiles/web/node_modules/@dsh-dds \
    && ln -sfn /app/packages/dsh-dds-core /usr/local/lib/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /app/prebuilt-profiles/web/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /var/lib/dsh/profiles/web/node_modules/@dsh-dds/core

# Standard unadulterated pnpm engine configured for unprivileged non-root runtime store
RUN ln -sf /usr/local/lib/node_modules/pnpm/bin/pnpm.mjs /usr/local/bin/pnpm \
    && ln -sf /usr/local/bin/pnpm /usr/local/bin/pn \
    && mkdir -p /home/dsh/.local/share/pnpm/store /home/dsh/.config/pnpm \
    && echo "store-dir=/home/dsh/.local/share/pnpm/store" >> /home/dsh/.pnpmrc \
    && echo "minimum-release-age=0" >> /home/dsh/.pnpmrc \
    && echo "minimumReleaseAge: 0" > /home/dsh/.config/pnpm/config.yaml

# Universal Runtime Compatibility & Sandboxing Loader (Zero Disk Patches)
ENV NODE_OPTIONS="--import /app/packages/dsh-dds-core/loader.mjs"

RUN chown -R dsh:dsh /home/dsh /var/lib/dsh /var/lib/dsh-state /run/dsh /var/log/dsh /etc/dsh \
    && chown -R root:root /app \
    && chmod -R 755 /app

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/dsh-dds/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER dsh:dsh
WORKDIR /home/dsh

ENTRYPOINT ["/usr/local/bin/dsh-entrypoint"]
