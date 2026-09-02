# 🚀 DeepSeek Harness (DSH) — Multi-Provider Agent Operating Environment

[![Docker](https://img.shields.io/badge/Docker-24.0+-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-11+-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Arize Phoenix](https://img.shields.io/badge/Arize%20Phoenix-OTel%20Observability-purple)](https://github.com/Arize-ai/phoenix)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An enterprise-grade, containerized autonomous agent runtime on **DeepSeek Harness (DSH)** paired with **Arize Phoenix** for local real-time OpenTelemetry observability and cost attribution. Built with a **pnpm multi-stage architecture**, native **Google Gemini Thought Signature Bridge**, dynamic **OpenRouter (420+ models)** auto-synchronization on every boot, and pre-packaged productivity plugins.

---

## 🌟 Key Architecture Highlights

* **⚡ Multi-Stage Lightweight Docker Build**: Two-stage Docker build utilizing `pnpm` for native compilation (`node-pty`) while stripping all build toolchains in the runner stage (< 1 MB writable layer).
* **🧠 Native Gemini Thought Signature Bridge**: Eliminates HTTP 400 errors when using Google AI Studio (`gemini-3.7-flash` / `gemini-3.6-flash`) by dynamically preserving and returning Google's reasoning `thought_signature` across multi-turn tool calling steps.
* **🔄 Automatic Dynamic Model Synchronization**: Automatically queries OpenRouter (420+ models) and Google AI Studio (29+ models) on container boot, caching live pricing, context limits, and token specs into local DSH configuration and registering custom providers with Arize Phoenix for OTel trace capture.
* **📊 100% Local Arize Phoenix Telemetry**: Integrated local OpenTelemetry collector and web dashboard visualizing agent trajectories, tool waterfalls, token consumption, and model latency without sending data to external clouds.
* **🧩 10 Pre-Packaged English Plugins & 4 MCP Servers**: Pre-baked with Visual Workflow Canvas (`deepseek-flow`), Web Search, Plugin Market, Model Configurator, Context7 Docs, GitHub MCP operations, SQLite relational database analysis, visual MCP marketplace, and persistent unified memory.

---

## 🎯 Design Motivation & Governance Rationale

Modern enterprise AI deployments face three critical operational constraints:
1. **Data Sovereignty & Regulatory Compliance (EU AI Act / DORA / NIS 2)**: Cloud-hosted telemetry often leaks sensitive prompts, internal code, and credentials to third-party SaaS vendors. This stack enforces a **100% local OpenTelemetry collector (Arize Phoenix)** running on an internal Docker bridge, retaining all telemetry spans, pricing, and prompt traces entirely on-premise.
2. **AI FinOps & Model Arbitrage**: Hardcoding a single frontier LLM across all tasks introduces unacceptable cost and latency. By decoupling agent capabilities into **6-Layer Personas** with calibrated multi-model routing, trivial triage executes on lightweight flash models while expensive reasoning tiers are invoked selectively.
3. **Reproducibility & Personas-as-Code**: Ad-hoc conversational prompt engineering creates fragile, unversioned workflows. DeepSeek Harness encapsulates domain skills, model matrices, execution profiles, and MCP tools into **version-controlled declarative packages (`persona.yaml` + `SKILL.md`)** subject to standard Git review and CI/CD validation.

---

## 📚 Documentation Suite

For comprehensive deep dives, architectural guides, and troubleshooting:

* 🏛️ **[System Architecture](docs/architecture.md)** — Dual-container topology, kernel proxy, and OTel pipelines.
* 🎭 **[AI Agent Personas](docs/personas.md)** — Multi-Model Task Matrix, session recording, and automated persona distillation.
* 🔬 **[AI Personas Research Note](docs/research-notes-ai-personas.md)** — Theoretical foundations, academic literature (Stanford, Google, Anthropic), and industry framework comparisons.
* 🎨 **[Prompt-Driven Customization](docs/customization.md)** — Teaching skills, MCP servers, and local model routing via chat.
* ❓ **[Troubleshooting & Diagnostics](docs/troubleshooting.md)** — Diagnostic matrix, Gemini 400 thought signatures, and port debugging.
* 🧩 **[Plugins & MCP Reference](docs/plugins.md)** — Comprehensive guide to all 10 plugins and 4 MCP servers.
* 🔒 **[Security & Sandbox Guide](docs/security.md)** — Filesystem boundaries, `workspace-write` policy, and token isolation.
* 🕹️ **[Standard Operations & CLI Manual](docs/standard-operations.md)** — Daily operations, headless scripting, and `./dsh.sh` CLI matrix.
* 🧪 **[End-to-End Test Scenario](docs/testing-scenario.md)** — Step-by-step walkthrough: interactive chat, trace audit, and persona distillation.

---

## 📦 Pre-Packaged Plugins & MCP Servers

### 1. DSH Plugins (10 Pre-Installed)

| Plugin | Service ID | Category | Purpose |
| :--- | :--- | :--- | :--- |
| **`@liustack/modsearch`** | `modsearch` | Search | Free integrated web search provider |
| **`deepseek-flow`** | `deepseek-flow` | Workflows | Interactive visual canvas & DAG workflow designer |
| **`dshmarket`** | `dsh-market` | Marketplace | Visual Plugin Marketplace (English Localized) |
| **`dsh-find-plugin`** | `find-dsh-plugin` | Navigation | Workspace file and symbol finder |
| **`dsh-mcp-panel`** | `mcp-panel` | Tools | Model Context Protocol (MCP) management panel |
| **`dsh-mcp-market`** | `dsh-mcp-market` | Marketplace | Visual MCP Server Marketplace with 1-click install |
| **`dsh-provider-model-configurator`** | `dsh-provider-model-configurator` | Models | Visual LLM provider and model manager |
| **`dsh-model-sync`** | `model-sync` | Telemetry | Automated model sync and quota monitor widget |
| **`dsh-mnemon`** | `mnemon` | Memory | Unified Multi-Workspace Memory Engine & Recall |
| **`dsh-session-reader`** | `dsh-session-reader` | Inspection | Cross-session log and tool call inspector |

### 2. Pre-Configured MCP Servers

| MCP Server | Runner | Capabilities |
| :--- | :--- | :--- |
| **`fetch`** | `mcp-server-webresearch` (`@mzxrai/mcp-webresearch@0.1.7`) | Web scraping, page summarization, and live URL fetching |
| **`context7`** | `context7-mcp` (`@upstash/context7-mcp@1.0.14`) | Real-time SDK documentation & library context |
| **`github`** | `github-mcp-server` (`v1.11.0`) | GitHub repository operations, PRs, issue management, and tree inspection |
| **`sqlite-db`** | `mcp-server-sqlite` (`mcp-server-sqlite@2025.4.25`) | Relational SQL querying, schema inspection, and tabular data analysis |

---

## 🚀 Quick Start: Installation Options

You can install and run DeepSeek Harness using either the **1-File Turnkey Installer** (no Git clone required) or by **Cloning the Repository**.

### Option A: Turnkey 1-File Installer (Fresh Machine / Server)
To set up a complete deployment on a new machine without cloning the git repository:

```bash
# 1. Download the standalone installer script
curl -fsSL https://raw.githubusercontent.com/hdjebar/DSH-DDS/main/install_dsh.sh -o install_dsh.sh
chmod +x install_dsh.sh

# 2. Run the installer
./install_dsh.sh
```

**How Option A handles `.env` & Configuration:**
* 🔑 **Interactive Key Prompt**: If no `.env` file exists, the installer interactively prompts for your `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, and port.
* 📝 **Populate Later**: You can press Enter to skip any key during installation; the script will generate a starter `.env` template that you can edit anytime later (`nano .env`).
* 📦 **Automatic Scaffolding**: Automatically provisions the complete `config/` tree, 10 plugins, 4 offline MCP servers, and downloads the `./dsh.sh` Multi-Model Persona CLI wrapper.

---

### Option B: Clone the Repository (Developers & Customizers)

#### 1. Clone & Enter Directory
```bash
git clone https://github.com/hdjebar/DSH-DDS.git
cd DSH-DDS
```

#### 2. Configure Environment Variables
```bash
cp .env.example .env
nano .env
```
Configure your credentials in `.env`:
```env
DSH_PORT=3080
GEMINI_API_KEY=your_google_ai_studio_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
GITHUB_PERSONAL_ACCESS_TOKEN=your_github_personal_access_token
PHOENIX_API_KEY=your_optional_phoenix_key
```

#### 3. Launch the Stack
```bash
./dsh.sh up
# Or: docker compose up -d --build
```

> [!TIP]
> **Analyzing Untrusted Code?**  
> When using DSH to analyze external or unverified code repositories, start with the sandbox override:
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
> ```

#### 4. Run System Diagnostics
```bash
./dsh.sh doctor
```

---

## 🌐 Web Interfaces & Endpoints

| Service | Local URL | Container Port | Purpose |
| :--- | :--- | :--- | :--- |
| **DeepSeek Harness Web UI** | **[http://localhost:3080](http://localhost:3080)** | `3080` (proxy) → `3079` (engine) | Interactive AI Agent Workbench |
| **Arize Phoenix Telemetry** | **[http://localhost:6006](http://localhost:6006)** | `6006` | Real-time LLM Traces, Spans & Token Costs |

---

## 📁 Understanding the `config/` Directory & Persistent Storage

In `docker-compose.yml`, the local `./config` folder on your host is bind-mounted to `/root/.dsh` inside the container.

> [!NOTE]
> **You do NOT need to create or configure the `config/` folder before installing.**
> The installer or git repository automatically scaffolds everything. Once running, all your interactive work, chat sessions, learned agent memories, and custom personas are automatically saved into `./config` on your host machine so they **survive container rebuilds, updates, and restarts**.

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
    │   ├── package.json
    │   └── cordis.patch.yml
    ├── cli/                     # Interactive terminal profile
    └── headless/                # One-shot autonomous CLI runner profile
```

---

## 🛡️ Hardened Sandbox Mode (Untrusted Code Evaluation)

When using DSH to analyze external or unverified code repositories, start with the sandbox override:

```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

> [!WARNING]
> **Mandatory Plugin Security Audit**: Any plugin or MCP server added to the environment **must be thoroughly audited** to avoid severe security issues. Third-party plugins execute in-process with runtime privileges and have access to workspace data, container memory, and API credentials. Unvetted plugins can introduce supply chain attacks, arbitrary code execution, or credential exfiltration risks.

**Sandbox Protections:**
* **Disposable Runtime Configuration**: Copies `./config` from `/opt/dsh-config:ro` into an in-memory `/root/.dsh` tree on every start.
* **Read-Only Workspaces (`/workspaces:ro`)**: Protects host files from unauthorized modification.
* **Linux Capability Stripping (`cap_drop: [ALL]`)**: Drops all privileged container capabilities.
* **No New Privileges (`no-new-privileges:true`)**: Prevents privilege escalation inside the container.
* **Zero-Egress Network**: Keeps DSH and Phoenix on an internal bridge without external network access.
* **Persistent Session Data Only**: Preserves session transcripts and DSH JSON storage in the `sandbox-session-state` volume while profiles, patches, and caches remain disposable.
* **Process & Resource Caps**: Limits container to 2 CPUs, 2GB RAM, and 150 PIDs.

Remove sandbox session history with:

```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml down -v
```

---

## 🧪 Automated Regression & Supply-Chain Test Suite

The repository includes a comprehensive regression and parity test suite built on Node.js test runner:

```bash
# Run all regression & installer parity tests
node --test tests/*.test.mjs
```

**What the test suite covers:**
1. **CLI Argument Parser**: Validates `--option=value`, short flags (`-t`, `-p`), mixed ordering, prompts with quotes/spaces, and rejects malformed/unknown options.
2. **Installer Parity Assertion**: Enforces byte-for-byte equality between `install_dsh.sh` templates and canonical repo files (`Dockerfile`, `docker-compose.yml`, `package.json`, `cordis.patch.yml`).
3. **CI Pipeline**: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) builds Docker images with `--no-cache`, validates entrypoint `bash -n`, and runs `--network none` offline MCP smoke tests on every push.

---

## 🔄 Maintenance & Ecosystem Updates

### 1. Refreshing Models on Demand
The container automatically synchronizes models on every boot. To trigger a manual resync without restarting:
```bash
docker compose exec dsh node /root/.dsh/sync_models.mjs
```

### 2. Updating DeepSeek Harness Core Image
When upstream releases a new DSH base image:
```bash
# 1. Pull latest upstream images
docker compose pull

# 2. Rebuild local layer with pre-packaged plugins and patches
docker compose up -d --build
```

### 3. Updating DSH Plugins & MCP Servers
To upgrade all installed Node.js plugins and MCP packages:
```bash
# Inside the container web profile
docker compose exec dsh bash -c "cd /root/.dsh/profiles/web && pnpm update && pnpm prune --prod"

# Restart container to load updated plugin bundles
docker compose restart dsh
```

### 4. Updating Arize Phoenix
To update the telemetry container to the latest Phoenix release:
```bash
docker compose pull phoenix
docker compose up -d phoenix
```
*(All traces and custom provider settings remain preserved in `./config/phoenix`)*.

### 5. Backups & Disaster Recovery
To backup your complete workspace configurations, conversations, memories, and traces:
```bash
# Create a timestamped archive of your config and database state
tar -czvf "dsh_backup_$(date +%Y%m%d_%H%M%S).tar.gz" config/ workspaces/ .env
```

To restore on a new machine:
```bash
tar -xzvf dsh_backup_*.tar.gz
docker compose up -d --build
```

### 6. Health Checks & Diagnostics
```bash
# Check running container health
docker compose ps

# View unified real-time logs
docker compose logs -f

# View DSH agent logs specifically
docker compose logs -f dsh

# View Phoenix telemetry logs specifically
docker compose logs -f phoenix
```

---

## 💻 CLI & Headless Automations

DeepSeek Harness includes powerful CLI runners for scripts, background jobs, and CI/CD:

### Interactive Terminal Mode
```bash
docker compose exec -it dsh dsh --profile cli
```

### One-Shot Headless Execution
Run a prompt autonomously and output results directly to stdout:
```bash
# Using default model (Gemini 3.7 Flash)
docker compose exec dsh dsh --profile headless "summarize recent git commits in /workspaces"

# On-the-fly model override with DeepSeek V3 (OpenRouter)
docker compose exec dsh dsh --profile headless \
  --patch <(echo "- id: agent-default-model
  config:
    provider: openrouter
    model: deepseek/deepseek-chat") \
  "audit security policies in /workspaces"
```

---

## 🔒 Security Best Practices

- **Never commit `.env`**: Always verify that `.env` is listed in `.gitignore`.
- **Fine-Grained GitHub Tokens**: When using the GitHub MCP server, restrict token scope to only the specific repositories needed.
- **Set Usage Limits**: Configure billing hard caps in [Google AI Studio](https://aistudio.google.com/) and [OpenRouter](https://openrouter.ai/).

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
