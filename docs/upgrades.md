# 🔄 Upstream Upgrades & Component Evolution Guide

This guide details how **DSH-DDS** manages and adopts new versions of **DeepSeek Harness**, the **Cordis Microkernel**, **Plugins**, and **Model Context Protocol (MCP) Tools**.

---

## 1. Architectural Philosophy: From Brittle Hacks to Invariant Governance

In traditional agent environments and legacy DSH deployments (v1), upgrading upstream dependencies was notoriously hazardous:
* **Monkey-Patching Fragility**: Modifying upstream JavaScript using regex find-and-replace scripts failed whenever upstream developers altered variable names, whitespace, or import ordering.
* **Non-Deterministic Dynamic Downloads**: Running commands like `npx -y <mcp-tool>` at runtime led to sudden build breaks, version drift, and supply-chain vulnerabilities.
* **Root Execution Confinement**: Updates often broke filesystem permissions when containers ran indiscriminately as `root` (UID 0).

### The Level 4.0 Architectural Invariants
DSH-DDS was redesigned from the ground up around **10 Invariants of Agent Reliability**:
1. **Invariant 1 (Zero Monkey-Patching)**: No regex file modifications or on-disk AST rewrites. All custom behavior hooks clean Inversion-of-Control (IoC) service contracts.
2. **Invariant 2 (Non-Root Execution)**: Everything runs as unprivileged `dsh:dsh` (UID/GID 1000) with strict Linux FHS separation.
3. **Invariant 9 (Build-Time Immutability)**: All MCP tools, plugins, and dependencies are baked, pre-compiled, and offline smoke-tested at build time. Zero runtime package downloads.

---

## 2. Component-by-Component Upgrade Mechanics

```
                         UPSTREAM UPGRADE IMPACT & SAFETY MATRIX
  ┌──────────────────────┬───────────────────────────────┬────────────────────────────────┬───────────────────────────┐
  │ Component            │ Upstream Hazard               │ DSH-DDS Protective Control     │ Verification Command      │
  ├──────────────────────┼───────────────────────────────┼────────────────────────────────┼───────────────────────────┤
  │ DeepSeek Harness     │ Internal AST/layout refactor  │ Cordis IoC + Node loader hooks │ npm test && ./dsh.sh doc  │
  │ Cordis Microkernel   │ Service signature shifts      │ Version-gated semantic adapter │ npm test                  │
  │ Community Plugins    │ Vulnerabilities / bad state   │ In-Line PEP + Envoy Egress     │ npm test                  │
  │ MCP Tools            │ Protocol breaks / net bloat   │ Hermetic baking + Offline test │ docker run --network none │
  └──────────────────────┴───────────────────────────────┴────────────────────────────────┴───────────────────────────┘
```

---

### A. DeepSeek Harness (`@deepseek-ai/dsh`)

DeepSeek Harness is the core agent web interface and workspace manager.

#### How It Is Bound
* Pinned in [`Dockerfile`](../Dockerfile#L46):
  ```dockerfile
  npm install -g @deepseek-ai/dsh@0.1.2-rc.1
  ```
* Global links expose `/usr/local/bin/dsh` and the Cordis runtime binaries.

#### Why It Doesn't Break on Upgrades
* In DSH-DDS, all integrations run via the native in-tree plugin [`@dsh-dds/core`](../packages/dsh-dds-core).
* The plugin registers against public Cordis hooks (`ctx.inject(['webServer'])`, `ctx.webServer.tapIndex()`) and the Node.js loader hook (`NODE_OPTIONS="--import /app/packages/dsh-dds-core/loader.mjs"`).
* Because DSH-DDS does not modify minified upstream files on disk, internal refactoring inside `@deepseek-ai/dsh` does not break the container boot cycle.

#### Step-by-Step Upgrade Workflow
1. **Edit [`Dockerfile`](../Dockerfile)**: Update the version tag:
   ```dockerfile
   RUN npm install -g @deepseek-ai/dsh@<NEW_VERSION> ...
   ```
2. **Rebuild the image**:
   ```bash
   ./dsh.sh build
   ```
3. **Validate runtime health**:
   ```bash
   npm test               # Validates all 153 unit and regression tests
   ./dsh.sh doctor        # Validates runtime sockets, models, and file permissions
   ```
4. **Handling Breaking API Changes**:
   If an upstream release changes internal route schemas or service signatures, update the semantic version adapter inside [`packages/dsh-dds-core/gateway.js`](../packages/dsh-dds-core/gateway.js):
   ```javascript
   if (semver.gte(dshVersion, '0.2.0')) {
     // Adapt to new service signature
   } else {
     // Retain backward-compatible fallback
   }
   ```

---

### B. Cordis Microkernel (`@cordisjs/*` / `cordis`)

Cordis is the modular Inversion-of-Control (IoC) framework orchestrating all DeepSeek Harness services, plugins, and web servers.

#### How It Is Bound
* Cordis packages resolve through `@deepseek-ai/dsh` peer dependencies and `config/profiles/web/package.json`.
* Service wiring is declaratively defined in [`config/cordis.patch.yml`](../config/cordis.patch.yml) and [`config/profiles/web/cordis.patch.yml`](../config/profiles/web/cordis.patch.yml).

#### Why It Doesn't Break on Upgrades
* Cordis follows strict semantic versioning for lifecycle contracts.
* Services in DSH-DDS declare explicit injection constraints:
  ```javascript
  // packages/dsh-dds-core/index.js
  export const name = 'dsh-dds-core';
  export const inject = ['webServer'];
  ```
* Because dependencies are injected by contract rather than hardcoded global references, Cordis updates resolve cleanly within the IoC container.

#### Step-by-Step Upgrade Workflow
1. If Cordis is updated upstream as part of `@deepseek-ai/dsh`, the runtime absorbs it automatically.
2. If custom service extensions are needed, configure them in `config/cordis.patch.yml` without modifying core files.
3. Test service injection:
   ```bash
   node --test tests/universal_compatibility.test.mjs
   ```

---

### C. Community & Core Plugins

DSH-DDS separates plugins into two distinct categories:

#### 1. Web Profile Community Plugins
Declared in [`config/profiles/web/package.json`](../config/profiles/web/package.json):
* `dshmarket` (Visual plugin catalog)
* `dsh-mnemon` (Multi-tier session memory)
* `deepseek-flow` (Visual DAG workflow canvas)
* `dsh-better-sidebar` (Enhanced sidebar layout)
* `dsh-mcp-panel` (MCP server visual telemetry)
* `dsh-provider-model-configurator` (Model selector)

##### Upgrade Procedure:
1. Update dependency versions in `config/profiles/web/package.json`:
   ```bash
   cd config/profiles/web
   pnpm up dsh-mnemon@latest deepseek-flow@latest
   ```
2. Rebuild the container image:
   ```bash
   ./dsh.sh build
   ```
   *The Stage 1 multi-stage builder (`Dockerfile:1-23`) automatically compiles native extensions (`node-gyp`), caches packages into the persistent pnpm store, and prunes dev dependencies.*

##### Protective Guardrails for Plugins:
* **The Danger**: Plugins execute in-process within Node.js and have access to memory and environment variables.
* **The DSH-DDS Defense**:
  * **In-Line PEP ([`packages/dsh-dds-core/rbac-interceptor.js`](../packages/dsh-dds-core/rbac-interceptor.js))**: Intercepts every `tool-execute` event at the microkernel level. Even if a plugin attempts an unauthorized file read or system command, it is blocked fail-closed (`RBAC_DENIED`).
  * **Envoy Egress Lockdown ([`config/network/envoy-egress.yaml`](../config/network/envoy-egress.yaml))**: Restricts outbound HTTP/S traffic strictly to Tier 1 trusted model endpoints (Google AI Studio, OpenRouter, GitHub API). Unauthorized external calls by rogue plugins are rejected.

#### 2. Native In-Tree Core Plugins (`@dsh-dds/core`)
* Maintained under Git version control at [`packages/dsh-dds-core/`](../packages/dsh-dds-core/).
* Upgrades to core capabilities (e.g. BYOK Vault, Policy Enforcement Point, Model Catalog) are developed in-tree, covered by unit tests in `tests/`, and versioned alongside the repository.

---

### D. Model Context Protocol (MCP) Servers

MCP servers provide tool execution capabilities to LLM agents (file searching, SQL querying, Git operations).

#### Current Pinned MCP Matrix:

| MCP Tool | Execution Format | Pinned Reference | Build Layer |
| :--- | :--- | :--- | :--- |
| **`github-mcp-server`** | Native Go Static Binary | `ghcr.io/github/github-mcp-server:v1.11.0` | Multi-stage Docker copy (`Dockerfile:31`) |
| **`mcp-server-sqlite`** | Python Tool via Astral `uv` | `mcp-server-sqlite@2025.4.25` | `uv tool install` in `/opt/uv-tools` (`Dockerfile:49`) |
| **`mcp-webresearch`** | Node.js stdio service | `@mzxrai/mcp-webresearch@0.1.7` | Global npm install (`Dockerfile:46`) |
| **`context7-mcp`** | Node.js stdio service | `@upstash/context7-mcp@1.0.14` | Global npm install (`Dockerfile:46`) |

#### Why Dynamic Runtime MCP Fetching Is Blocked (ADR 0007)
Using `npx -y @modelcontextprotocol/...` at runtime is strictly prohibited in DSH-DDS because:
1. It introduces cold-start network latencies of 15–45 seconds per tool execution.
2. It breaks in air-gapped, zero-egress environments (`docker-compose.sandbox.yml`).
3. An unpinned upstream release could introduce silent breaking changes or malicious payload injection into agent workflows.

#### Step-by-Step MCP Upgrade Workflow:
1. **Update the pinned version in [`Dockerfile`](../Dockerfile)**:
   * For Go binaries: update the image tag on `COPY --from=...`.
   * For Python tools: update the version in `uv tool install mcp-server-sqlite@<VERSION>`.
   * For Node.js servers: update the version in `npm install -g ...`.
2. **Rebuild**:
   ```bash
   ./dsh.sh build
   ```
3. **Verify Offline Isolation**:
   Confirm that the new MCP binary functions hermetically without network access:
   ```bash
   docker run --rm --network none dsh-local:latest github-mcp-server --version
   docker run --rm --network none dsh-local:latest mcp-server-sqlite --help
   ```
   *(This exact check is enforced automatically by the GitHub Actions CI pipeline).*

---

## 3. The Upgrade Safety & Verification Checklist

Before deploying any upgraded component to production, execute the 5-stage verification gate:

```bash
# 1. Verify installer script parity (Zero Drift)
npm run verify:installer

# 2. Run the hermetic Node.js test suite
npm test

# 3. Build container images with clean cache
./dsh.sh build

# 4. Verify system diagnostics and model health
./dsh.sh doctor

# 5. Run an autonomous smoke test with a persona
./dsh.sh persona run sdmx-expert "Ping STATEC API and report active dataflows"
```

---

## 4. Rollback Playbook

If an upstream release introduces an unforeseen bug or incompatibility:

### A. Instant Container Rollback
If you tagged or cached previous images:
```bash
docker tag dsh-local:backup dsh-local:latest
./dsh.sh restart
```

### B. Git Clean Rollback
Because all configurations, Dockerfiles, and lockfiles are tracked in Git:
```bash
# Revert to the last known stable commit
git checkout HEAD~1 Dockerfile config/profiles/web/package.json

# Rebuild and relaunch
./dsh.sh build
./dsh.sh up
```

### C. Persistent Data Safety
User workspaces ([`workspaces/`](../workspaces)), Phoenix traces ([`config/phoenix/`](../config/phoenix)), and encrypted BYOK credentials ([`config/keys/`](../config/keys)) reside on the host. Rolling back or rebuilding containers **never deletes or modifies user data**.
