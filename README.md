# 🚀 DeepSeek Harness (DSH) — Multi-Provider Agent Operating Environment

[![Docker](https://img.shields.io/badge/Docker-24.0+-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Docker Compose](https://img.shields.io/badge/Compose-2.24+-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![CI](https://github.com/hdjebar/DSH-DDS/actions/workflows/ci.yml/badge.svg)](https://github.com/hdjebar/DSH-DDS/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Run AI coding agents locally, and see exactly what they cost.**  
> A self-hosted Docker environment pairing DeepSeek Harness with an on-premise Arize Phoenix dashboard — every prompt, token, and dollar stays on your machine.

*For developers, platform engineers, and AI teams who need agent observability without sending prompts to a third-party SaaS.*

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ARIZE PHOENIX — LOCAL OPENTELEMETRY TRACE WATERFALL [http://localhost:6006]            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Trace: persona-execution [sdmx-expert]                         Latency: 1.84s   Cost: $0.0012 │
│ ├─ [Span] agent-think: Gemini 3.7 Flash (thought_signature preserved)     420ms   $0.0003  │
│ ├─ [Tool] mcp-fetch: GET https://lustat.statec.lu/rest/dataflow/...        310ms        -   │
│ ├─ [Tool] mcp-sqlite-db: SELECT indicator, value FROM dataset_cache        45ms        -   │
│ └─ [Span] agent-response: DeepSeek V3 (synthesize findings)               1065ms   $0.0009  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Quick Start

### Before You Start (Prerequisites)
* **Docker Engine 24+ & Docker Compose v2.24+** (`docker compose version`) — Compose 2.24+ is required for the sandbox `!override` syntax.
* **~4 GB free disk space** for the multi-stage image layers.
* **API Credentials (Optional at install time)**: Google AI Studio (`GEMINI_API_KEY`) or OpenRouter (`OPENROUTER_API_KEY`). You can launch without keys and populate them in `.env` later.

---

### Step 1: Choose Your Installation Path

#### Path A: Turnkey 1-File Installer (Recommended)
*Best for evaluators and standalone servers — no Git clone required:*

```bash
# 1. Download the standalone installer script
curl -fsSL https://raw.githubusercontent.com/hdjebar/DSH-DDS/main/install_dsh.sh -o install_dsh.sh
chmod +x install_dsh.sh

# 2. Run the turnkey installer (scaffolds environment & prompts for keys)
./install_dsh.sh
```

#### Path B: Clone the Repository
*Best for developers modifying personas, Dockerfiles, or plugins:*

```bash
git clone https://github.com/hdjebar/DSH-DDS.git
cd DSH-DDS

# Configure environment variables
cp .env.example .env
nano .env

# Launch the stack
./dsh.sh up
```

---

### Step 2: Confirm It Worked (Success Gate)

Run the automated diagnostic suite to verify container health, API credentials, and MCP permissions:

```bash
./dsh.sh doctor
```

```text
🩺 DeepSeek Harness Ecosystem Diagnostics (Doctor)
========================================================
🔍 [1/9] DeepSeek Harness Engine:        ✅ Listening on 127.0.0.1:3079 & 0.0.0.0:3080
🔍 [2/9] Arize Phoenix Telemetry:        ✅ Connected at http://phoenix:6006
🔍 [3/9] Google AI Studio Bridge:        ✅ Authenticated (gemini-3.7-flash live)
🔍 [4/9] OpenRouter Gateway:             ✅ Authenticated (420+ models available)
🔍 [5/9] GitHub MCP Token:               ✅ Authenticated
🔍 [6/9] MCP Binaries & Permissions:     ✅ 4 servers verified (fetch, context7, github, sqlite-db)
🔍 [7/9] Automated Model Sync:           ✅ Active & Healthy
🔍 [8/9] Pre-Packaged Plugins:           ✅ 10 plugins installed & active
🔍 [9/9] Storage & Volume Mounts:        ✅ /root/.dsh and /workspaces writable
========================================================
📊 Summary: 23 Passed | 0 Warnings | 0 Failed
```

*Nine suites report ✅ or ⚠️. (A ⚠️ on an optional provider you didn't configure is expected).*

* **DeepSeek Harness Web UI**: [http://localhost:3080](http://localhost:3080)
* **Arize Phoenix Telemetry**: [http://localhost:6006](http://localhost:6006)
* *⏱️ Time to first value: ~10 minutes (mostly one-time Docker image build).*

---

### Step 3: Now Try (Next Steps)

1. **Run your first persona**:
   ```bash
   ./dsh.sh persona run sdmx-expert "List top statistical indicators from STATEC"
   ```
2. **Inspect the live trace in Phoenix**: Open [http://localhost:6006](http://localhost:6006) to examine prompt spans, tool call latencies, and token costs.
3. **Follow the guided walkthrough**: [End-to-End Testing Scenario](docs/testing-scenario.md).

---

## 💡 Why This Exists

1. **Your prompts stay yours**: Cloud-hosted tracing tools send sensitive prompts, codebases, and credentials to external SaaS vendors. Phoenix runs locally on an internal Docker bridge (`127.0.0.1:6006`); no telemetry leaves your machine. Essential for EU AI Act, DORA, and NIS 2 data sovereignty.
2. **One frontier model for every task is expensive**: Running every trivial tool execution through Claude 3.5 Sonnet or GPT-4o inflates costs. Personas decouple work into calibrated model tiers — flash models handle drafting while reasoning tiers are invoked selectively.
3. **Prompt engineering in chat isn't reproducible**: Ad-hoc conversational prompt tweaks are easily lost. Personas encapsulate domain skills, model tiers, and MCP tools into **version-controlled declarative packages (`persona.yaml` + `SKILL.md`)** tracked directly in Git.

---

## 🌟 What It Gives You

* **📊 100% Local Arize Phoenix Telemetry**: Integrated OpenTelemetry collector and dashboard visualizing agent trajectories, token waterfalls, latency bottlenecks, and exact invocation costs.
* **🔄 Automatic Dynamic Model Synchronization (`dsh-model-sync`)**: Queries OpenRouter (420+ models) and Google AI Studio (31+ models) on boot, caching live pricing, context limits, and token specs into local DSH configuration. Displays live token quotas and balance rings directly in the Web UI.
* **🛡️ Hardened Sandbox Mode**: Drop-in `docker-compose.sandbox.yml` with read-only root filesystems, stripped Linux capabilities (`cap_drop: ALL`), disabled privilege escalation, and zero-egress network isolation for evaluating untrusted code.

---

## 🚫 What This Is Not

* **Not a hosted cloud SaaS**: This is a self-hosted infrastructure stack. You run the Docker containers on your local workstation, VM, or private cloud.
* **Not a multi-user shared service by default**: By default, DeepSeek Harness and Arize Phoenix bind strictly to loopback (`127.0.0.1`). If deploying for team access, configure reverse proxy authentication or set `PHOENIX_ENABLE_AUTH=true` with `PHOENIX_SECRET`.
* **Not native Windows**: Runs as a standard Linux container environment via Docker Desktop or WSL2 on Windows, macOS, and Linux.

---

## 🎭 Personas-as-Code (Worked Example)

Personas package instructions, model matrices, and MCP tools into clean, declarative YAML:

```yaml
# config/personas/sdmx-expert/persona.yaml
name: sdmx-expert
title: SDMX 2.1 Statistical Data Specialist
models:
  default:
    provider: openrouter
    model: deepseek/deepseek-chat
  reasoning:
    provider: openrouter
    model: deepseek/deepseek-r1
  coding:
    provider: google
    model: gemini-3.7-flash
mcpServers:
  fetch:
    command: /usr/local/bin/mcp-server-webresearch
  sqlite-db:
    command: /root/.local/bin/mcp-server-sqlite
    args: ["--db-path", "/workspaces/data.db"]
rbac:
  role: sdmx_expert
  permissions:
    filesystem:
      read: ["/workspaces", "/root/.dsh/personas/sdmx-expert"]
      write: ["/workspaces", "/root/.dsh/sessions"]
      deny: ["/etc", "/root/.ssh", "config/personas/*", "reset.sh", "install_dsh.sh"]
    mcp:
      allowed: ["fetch", "sqlite-db"]
workflows:
  extract_indicators:
    modelTier: reasoning
    steps:
      - name: Fetch SDMX Dataflows
        action: fetch_dataflows
        scope: /workspaces/data
```

Execute personas directly via the unified CLI wrapper:
```bash
# Run with calibrated default tier
./dsh.sh persona run sdmx-expert "Analyze inflation metrics for Luxembourg"

# Force reasoning model tier (DeepSeek-R1)
./dsh.sh persona run sdmx-expert --tier reasoning "Prove statistical correlation formula"
```

---

## 📦 Pre-Packaged Plugins & MCP Servers

### 1. Pre-Installed Plugins (10 Active)

| Plugin | Service ID | Category | Purpose |
| :--- | :--- | :--- | :--- |
| **`@liustack/modsearch`** | `modsearch` | Search | Integrated free web search provider |
| **`deepseek-flow`** | `deepseek-flow` | Workflows | Visual DAG canvas and workflow designer |
| **`dshmarket`** | `dsh-market` | Marketplace | Visual Plugin Marketplace (English Localized) |
| **`dsh-find-plugin`** | `find-dsh-plugin` | Navigation | Workspace file and symbol finder |
| **`dsh-mcp-panel`** | `mcp-panel` | Tools | Model Context Protocol management panel |
| **`dsh-mcp-market`** | `dsh-mcp-market` | Marketplace | Visual MCP Server Marketplace |
| **`dsh-provider-model-configurator`** | `dsh-provider-model-configurator` | Models | Visual LLM provider and model manager |
| **`dsh-model-sync`** | `model-sync` | Telemetry | Automated model sync and quota monitor |
| **`dsh-mnemon`** | `mnemon` | Memory | Multi-Workspace Unified Memory Engine |
| **`dsh-session-reader`** | `dsh-session-reader` | Inspection | Cross-session transcript and tool call reader |

### 2. Pre-Configured MCP Tool Servers (4 Built-In)

| MCP Server | Runner Executable | Capabilities |
| :--- | :--- | :--- |
| **`fetch`** | `mcp-server-webresearch` (`@mzxrai/mcp-webresearch@0.1.7`) | Web scraping, page summarization, live URL fetching |
| **`context7`** | `context7-mcp` (`@upstash/context7-mcp@1.0.14`) | Real-time SDK documentation & library context |
| **`github`** | `github-mcp-server` (`v1.11.0`) | GitHub repository operations, PRs, and issue tracking |
| **`sqlite-db`** | `mcp-server-sqlite` (`mcp-server-sqlite@2025.4.25`) | Relational SQL querying, schema inspection, tabular analysis |

---

## 📚 Documentation Suite (Diátaxis Organization)

Comprehensive guides organized by audience and operational goal:

### 🚀 Getting Started & Evaluation
* 🧪 **[End-to-End Test Scenario](docs/testing-scenario.md)** — Step-by-step walkthrough: interactive chat, trace inspection, and persona distillation.
* ❓ **[Troubleshooting & Diagnostics](docs/troubleshooting.md)** — Diagnostic matrix, Gemini 400 thought signatures, and port debugging.

### 🛠️ Daily Operations & Customization
* 🕹️ **[Standard Operations & CLI Manual](docs/standard-operations.md)** — Daily operations, headless scripting, and `./dsh.sh` command reference.
* 🎭 **[AI Agent Personas Guide](docs/personas.md)** — Multi-Model Task Matrix, session recording, and automated persona distillation.
* 🎨 **[Prompt-Driven Customization](docs/customization.md)** — Teaching skills, MCP servers, and local model routing via chat.

### 🏛️ Architecture & Security Reference
* 🏛️ **[SOTA AI Harness Architecture](docs/ai-harness-architecture-sota.md)** — **Comprehensive Whitepaper**: The 5 architectural pillars, theoretical foundations, NIST/OWASP/EU AI Act alignment, and comparative benchmarks.
* 🏛️ **[System Architecture](docs/architecture.md)** — Dual-container topology, kernel proxy, and OTel trace pipelines.
* 🧩 **[Plugins & MCP Reference](docs/plugins.md)** — Detailed specification of all 10 plugins and 4 MCP servers.
* 🔒 **[Security & Sandbox Guide](docs/security.md)** — Filesystem boundaries, Zero Trust persona RBAC, and network isolation.
* 📜 **[ADR 0001: Build-Time Immutability & RBAC](docs/adr/0001-build-time-immutability-and-rbac.md)** — Architecture Decision Record on build-time immutability, Zero Trust RBAC, and GRC audit logs.
* 📜 **[ADR 0002: Out-of-Band GRC & E2E Sandbox](docs/adr/0002-out-of-band-grc-and-deterministic-e2e-sandbox.md)** — Architecture Decision Record on out-of-band GRC telemetry and deterministic E2E sandbox verification.
* 📜 **[ADR 0003: Authoritative Declarative Orchestrator](docs/adr/0003-authoritative-declarative-orchestrator-and-capability-adapters.md)** — Architecture Decision Record on authoritative JavaScript orchestration, capability adapters, and fail-closed RBAC.
* 📜 **[ADR 0004: In-Container Boundaries & Strict Containment](docs/adr/0004-in-container-boundaries-and-strict-directory-containment.md)** — Architecture Decision Record on in-container execution boundaries, strict directory containment, and acyclic policy architecture.
* 📜 **[ADR 0005: Remediation of Audit v3 Findings](docs/adr/0005-remediation-of-audit-v3-findings.md)** — Architecture Decision Record on symlink ancestor canonicalization, truthful capability adapters, clean-room installer parity, and multi-state GRC auditing.

### 🔬 Theory & Research
* 🏛️ **[SOTA AI Harness Architecture](docs/ai-harness-architecture-sota.md)** — Academic foundations, formal definitions, and framework comparative analysis.
* 🔬 **[AI Personas Research Note](docs/research-notes-ai-personas.md)** — Theoretical foundations, academic literature, and industry framework comparisons.
* 🚀 **[Future Development Roadmap & Production Blueprint](docs/future-development/README.md)** — Master consolidated audit, capability maturity framework, and 4-phase engineering roadmap.

---

## 🌐 Web Interfaces & Endpoints

| Service | Local URL | Container Port | Purpose |
| :--- | :--- | :--- | :--- |
| **DeepSeek Harness Web UI** | **[http://localhost:3080](http://localhost:3080)** | `3080` (proxy) → `3079` (engine) | Interactive AI Agent Workbench |
| **Arize Phoenix Telemetry** | **[http://localhost:6006](http://localhost:6006)** | `6006` | Real-time LLM Traces, Spans & Token Costs |

---

## 📁 `config/` Directory & Persistent Storage

The local `./config` folder on the host is bind-mounted to `/root/.dsh` inside the container. All interactive chat histories, agent memories, and custom personas **survive container rebuilds, updates, and restarts**:

```text
config/                          # Mounted directly to /root/.dsh in container
├── cordis.patch.yml             # LLM provider routing & plugin config overlay
├── settings.yaml                # Agent defaults, active model tier & UI preferences
├── sync_models.mjs              # Dynamic OpenRouter & Google model synchronizer
├── doctor.mjs                   # Automated 9-suite diagnostic engine (./dsh.sh doctor)
├── persona.mjs                  # Multi-Model Persona CLI & Session Distiller
├── MEMORY.md                    # Long-term agent memory across sessions (dsh-mnemon)
├── phoenix/                     # Persistent Arize Phoenix SQLite database (/root/.phoenix)
├── sessions/                    # Historical chat transcripts & tool call logs (dsh-session-reader)
├── personas/                    # Active custom persona packages (persona.yaml, SKILL.md)
│   ├── sdmx-expert/             # Pre-configured SDMX 2.1 statistical data expert
│   └── data-analyst/            # Pre-configured tabular & SQLite data analyst
├── skills/                      # Active agent skill definitions loaded at runtime
│   └── <name>/SKILL.md
└── profiles/
    ├── web/                     # Web profile package manifest (10 plugins + 4 MCP servers)
    ├── cli/                     # Interactive terminal profile (@deepseek-ai/dsh-terminal)
    └── headless/                # One-shot autonomous CLI runner profile
```

---

## 🛡️ Hardened Sandbox Mode (Untrusted Code Evaluation)

When analyzing external or unverified code repositories, start with the sandbox override:

```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

**Sandbox Protections:**
* **Disposable Runtime Configuration**: Copies `./config` from `/opt/dsh-config:ro` into an in-memory `/root/.dsh` tree on every start.
* **Read-Only Workspaces (`/workspaces:ro`)**: Protects host files from unauthorized modification.
* **Linux Capability Stripping (`cap_drop: [ALL]`)**: Drops all privileged container capabilities.
* **No New Privileges (`no-new-privileges:true`)**: Prevents privilege escalation inside the container.
* **Zero-Egress Network**: Keeps DSH and Phoenix on an internal bridge without external network access.
* **Persistent Session Data Only**: Preserves session transcripts and DSH JSON storage in the `sandbox-session-state` volume while profiles, patches, and caches remain disposable.
* **Resource Caps**: Constrains container to 2 CPUs, 2GB RAM, and 150 PIDs.

To destroy all transient sandbox session data:
```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml down -v
```

---

## 🧪 Automated Regression & Supply-Chain Test Suite

The repository includes a comprehensive regression and parity test suite built on the Node.js test runner:

```bash
# Run all regression & installer parity tests
node --test tests/*.test.mjs
```

**What the test suite covers:**
1. **CLI Argument Parser**: Validates `--option=value`, short flags (`-t`, `-p`), mixed ordering, prompts with quotes/spaces, and rejects malformed/unknown options.
2. **YAML & Persona Schema Validation**: Validates structured YAML parsing and asserts patch validity across all 7 shipped personas.
3. **Secret Scrubber**: Asserts redaction of Google AI Studio keys, GitHub fine-grained PATs, and Bearer tokens.
4. **Installer Parity Assertion**: Dynamically asserts byte-for-byte synchronization between `install_dsh.sh` manifests and canonical repository files.
5. **CI & Supply-Chain Hardening**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) builds Docker images with `--no-cache`, validates ShellCheck and Hadolint, verifies entrypoint syntax, runs `npm audit`, and conducts `--network none` offline MCP smoke tests on every commit.

---

## 🔄 Maintenance & Operations

### 1. Resetting the Stack
```bash
# Soft Reset: Clears cache locks, temp files, and model sync without losing chat sessions
./dsh.sh reset

# Hard Reset: Confirms and wipes persistent databases and volume state
./dsh.sh reset --hard
```

### 2. Model Catalog Synchronization & Quotas (`dsh-model-sync`)
* **From Host CLI**:
  ```bash
  ./dsh.sh sync-models    # Triggers manual resync from OpenRouter & Google AI Studio
  ./dsh.sh models         # Displays active model totals, breakdown, and sync timestamp
  ```
* **Web UI Quota & Cost Rings**:
  * The pre-packaged `dsh-model-sync` plugin synchronizes model catalogs on container boot and dynamically renders live balance and 5h/7d plan quota rings beside the prompt composer.

### 3. Backups & Disaster Recovery
```bash
# Create timestamped archive of configuration, memories, and traces
tar -czvf "dsh_backup_$(date +%Y%m%d_%H%M%S).tar.gz" config/ workspaces/ .env

# Restore on a new machine
tar -xzvf dsh_backup_*.tar.gz
docker compose up -d --build
```

---

## 🤝 Contributing & Changelog

* 📖 **[Contributing Guide](CONTRIBUTING.md)**: Review our 3-stage promotion lifecycle (`installtest/` → local canonical → `origin/main`), coding standards, and test runner workflows.
* 📝 **[Changelog](CHANGELOG.md)**: Track release notes, security remediations, and audit findings.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
