# 🏛️ DeepSeek Harness & Phoenix System Architecture

```mermaid
flowchart TD
    subgraph Host ["💻 Host Environment (macOS / Linux / Windows)"]
        ENV[".env Configuration\n(Keys, Ports, Tokens)"]
        VOL_CFG["📁 ./config (Mounted to /root/.dsh)"]
        VOL_PHX["📁 ./config/phoenix (Mounted to /root/.phoenix)"]
        VOL_WS["📁 ./workspaces (Mounted to /workspaces)"]
        BROWSER["🌐 User Browser\n(Web UI: 3080 | Phoenix: 6006)"]
    end

    subgraph DSH_Container ["🐳 Container: dsh-local"]
        PROXY["🛡️ Reverse Proxy Gateway (Port 3080)\n0.0.0.0:3080 -> 127.0.0.1:3079"]
        CORE["⚡ DeepSeek Harness Kernel (Port 3079)\n@deepseek-ai/dsh"]
        
        subgraph Plugins ["🧩 Pre-Packaged Plugin Suite (10 Plugins)"]
            PLUG_SRC["@liustack/modsearch (Web Search)"]
            PLUG_FLOW["deepseek-flow (Visual Workflow Canvas)"]
            PLUG_MKT["dshmarket (Plugin Market)"]
            PLUG_FIND["dsh-find-plugin (File Finder)"]
            PLUG_MCP_PNL["dsh-mcp-panel & dsh-mcp-market"]
            PLUG_CFG["dsh-provider-model-configurator"]
            PLUG_SYNC["dsh-model-sync (Quota & Token Monitor)"]
            PLUG_MNEM["dsh-mnemon (Unified Memory System)"]
            PLUG_DISTILL["dsh-session-reader (Cross-Session Reader)"]
        end

        subgraph MCP_Servers ["🔌 Integrated MCP Servers"]
            MCP_FETCH["fetch (mcp-server-webresearch)"]
            MCP_CTX["context7 (context7-mcp)"]
            MCP_GH["github (github-mcp-server)"]
            MCP_SQL["sqlite-db (mcp-server-sqlite)"]
        end

        subgraph LLM_Bridges ["🧠 Model Provider Orchestration"]
            BRIDGE_GEMINI["Google Gemini Thought Signature Bridge\n(Intercepts & preserves thought_signature)"]
            AUTO_SYNC["Dynamic Boot Synchronizer (sync_models.mjs)\n(Fetches 420+ OpenRouter & 29+ Google Models)"]
        end

        OTEL_EXPORTER["📡 OTel Trace Exporter\n(@deepseek-ai/dsh-session-telemetry-otel)"]
    end

    subgraph Phoenix_Container ["📊 Container: dsh-phoenix"]
        PHOENIX_SRV["🔥 Arize Phoenix Engine (Port 6006)"]
        SQLITE_DB["💾 SQLite DB (/root/.phoenix/phoenix.db)\n(Persisted to ./config/phoenix)"]
        TRACES["🌊 Distributed Trace Waterfall & Evals"]
    end

    subgraph External_APIs ["☁️ External Cloud Providers"]
        API_GEMINI["Google AI Studio API\n(Gemini 3.7 Flash / 3.6 Flash)"]
        API_OPENROUTER["OpenRouter API Gateway\n(DeepSeek V3, R1, Claude, GPT-4o)"]
        API_GITHUB["GitHub REST / GraphQL API\n(Repos, PRs, Commits)"]
    end

    %% Connections
    BROWSER -->|Port 3080| PROXY
    BROWSER -->|Port 6006| PHOENIX_SRV
    PROXY --> CORE
    CORE --> Plugins
    CORE --> MCP_Servers
    CORE --> LLM_Bridges
    LLM_Bridges --> API_GEMINI
    LLM_Bridges --> API_OPENROUTER
    MCP_GH --> API_GITHUB
    
    CORE -->|OTLP Traces| OTEL_EXPORTER
    OTEL_EXPORTER -->|HTTP /v1/traces| PHOENIX_SRV
    PHOENIX_SRV --> SQLITE_DB
    PHOENIX_SRV --> TRACES
    AUTO_SYNC -->|GraphQL / SQLite| PHOENIX_SRV

    VOL_CFG -.-> CORE
    VOL_PHX -.-> SQLITE_DB
    VOL_WS -.-> CORE
```

---

## 🏗️ Core Layers

### 1. Dual-Container Runtime Layer
* **`dsh-local`**: Minimal production Node.js 24 image based on pinned digest `smanx/deepseek-harness:0.1.1-rc.2`. Compiles native binaries (`node-pty`) via multi-stage `pnpm`, embeds prebuilt plugins and MCP binaries, and exposes proxy port `3080` bound strictly to `127.0.0.1`.
* **`dsh-phoenix`**: Open-source Arize Phoenix instance (`arizephoenix/phoenix:20.5.0`) running uvicorn/Python on port `6006` bound strictly to `127.0.0.1` with embedded SQLite persistence.

### 2. Google Gemini Thought Signature Bridge
* In modern Gemini 3.x / 2.x Flash models, Google AI Studio generates reasoning tokens that require a proprietary `extra_content.google.thought_signature` when returning tool results in multi-turn conversations.
* DSH-DDS embeds an in-memory thought signature interceptor in `pi-ai` that captures the signature on chunk streams (Step 1) and re-attaches it on outbound tool response payloads (Step 2).

### 3. Dynamic Boot-Time Model Synchronizer (`sync_models.mjs`)
* Automatically queries `https://openrouter.ai/api/v1/models` and `https://generativelanguage.googleapis.com/v1beta/models` every time the container boots.
* Ingests all **420+ models** with real-time prompt/completion token pricing directly into the Arize Phoenix SQLite database and DeepSeek Harness runtime.

### 4. Authoritative Declarative Orchestrator & Acyclic Policy Engine (`config/`)
* **`DeclarativeWorkflowEngine` ([declarative-orchestrator.mjs](../config/declarative-orchestrator.mjs))**: Evaluates 100% declarative workflow recipes defined in `persona.yaml` natively in JavaScript, permanently replacing shell scripts. Implements 15 typed capability adapters with real cryptographic SHA-256 hashing, real HTTP endpoint reachability probes, and airgap containment ledgers.
* **Acyclic Policy Engine ([rbac-policy.mjs](../config/rbac-policy.mjs))**: Single source of truth for Zero Trust RBAC policy enforcement, canonical path resolution (`resolvePath`), strict directory containment (`isContainedWithin`), symlink ancestor canonicalization (`canonicalizeWithAncestorRealpath`), and escape detection (`checkSymlinkEscape`).
* **Multi-State GRC Audit Trail (`config/audit/audit_grc.jsonl`)**: Records structured decision lifecycle events (`POLICY_DECISION`, `STEP_GATED`, `STEP_COMPLETED`, `STEP_FAILED`) with 128-bit OTel parent-child span correlation (`AgentPhoenixTracer`).
* **In-Container Execution Boundary ([dsh.sh](../dsh.sh))**: Dispatches workflow execution directly into the running container (`docker compose exec dsh`), enforcing container Landlock LSM confinement, dropped capabilities (`cap_drop: ALL`), and read-only root filesystems.
