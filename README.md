# 🚀 DeepSeek Harness (DSH) — Docker Deployment Stack

[![Docker](https://img.shields.io/badge/Docker-24.0+-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-11+-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Arize Phoenix](https://img.shields.io/badge/Arize%20Phoenix-OTel%20Observability-purple)](https://github.com/Arize-ai/phoenix)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An enterprise-grade, lightweight, and production-ready Docker deployment stack for **DeepSeek Harness (DSH)** paired with **Arize Phoenix** for local real-time OpenTelemetry observability. Built with a **pnpm multi-stage architecture**, native **Google Gemini Thought Signature Bridge**, dynamic **OpenRouter (420+ models)** auto-synchronization on every boot, and pre-packaged productivity plugins.

---

## 🌟 Key Architecture Highlights

* **⚡ Multi-Stage Lightweight Docker Build**: Two-stage Docker build utilizing `pnpm` for native compilation (`node-pty`) while stripping all build toolchains in the runner stage ($< 1\text{ MB}$ writable layer).
* **🧠 Native Gemini Thought Signature Bridge**: Eliminates HTTP 400 errors when using Google AI Studio (`gemini-3.7-flash` / `gemini-3.6-flash`) by dynamically preserving and returning Google's reasoning `thought_signature` across multi-turn tool calling steps.
* **🔄 Automatic Dynamic Model Synchronization**: Automatically queries OpenRouter (419+ models) and Google AI Studio (29+ models) on container boot, syncing live pricing, context limits, and token specs into both DSH and Arize Phoenix.
* **📊 100% Local Arize Phoenix Telemetry**: Integrated local OpenTelemetry collector and web dashboard visualizing agent trajectories, tool waterfalls, token consumption, and model latency without sending data to external clouds.
* **🧩 10 Pre-Packaged English Plugins & 3 MCP Servers**: Pre-baked with Visual Workflow Canvas (`deepseek-flow`), Web Search, Plugin Market, Model Configurator, Context7 Docs, GitHub MCP operations, visual MCP marketplace, and persistent unified memory.

## 📚 Documentation Suite

For comprehensive deep dives, architectural guides, and troubleshooting:

* 🏛️ **[System Architecture](docs/architecture.md)** — Dual-container topology, kernel proxy, and OTel pipelines.
* 🎭 **[AI Agent Personas](docs/personas.md)** — Multi-Model Task Matrix, session recording, and automated persona distillation.
* 🔬 **[AI Personas Research Note](docs/research-notes-ai-personas.md)** — Theoretical foundations, academic literature (Stanford, Google, Anthropic), and industry framework comparisons.
* 🎨 **[Prompt-Driven Customization](docs/customization.md)** — Teaching skills, MCP servers, and local model routing via chat.
* ❓ **[Troubleshooting & Diagnostics](docs/troubleshooting.md)** — Diagnostic matrix, Gemini 400 thought signatures, and port debugging.
* 🧩 **[Plugins & MCP Reference](docs/plugins.md)** — Comprehensive guide to all 10 plugins and 3 MCP servers.
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
| **`fetch`** | `@mzxrai/mcp-webresearch` | Web scraping, page summarization, and live URL fetching |
| **`context7`** | `@upstash/context7-mcp` | Real-time SDK documentation & library context |
| **`github`** | `@modelcontextprotocol/server-github` | Repositories, PRs, issues, commits, and code search |

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/hdjebar/DSH-DDS.git
cd DSH-DDS
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and insert your credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```env
DSH_PORT=3080
GEMINI_API_KEY=your_google_ai_studio_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
GITHUB_PERSONAL_ACCESS_TOKEN=your_github_personal_access_token
PHOENIX_API_KEY=your_optional_phoenix_key
```

### 3. Deploy Stack

#### Option A: Turnkey Script (Supports Separating Boot & Target Directories)
```bash
# Optional: Specify target installation directory
export DSH_INSTALL="$HOME/dsh"

chmod +x install_dsh.sh
./install_dsh.sh
```

#### Option B: Direct Docker Compose
```bash
docker compose up -d --build
```

### 4. Access Web Interfaces

| Service | URL | Purpose |
| :--- | :--- | :--- |
| **DeepSeek Harness Web UI** | **[http://localhost:3080](http://localhost:3080)** | Interactive AI Agent Interface |
| **Arize Phoenix Dashboard** | **[http://localhost:6006](http://localhost:6006)** | Real-Time Agent Traces & Telemetry |

---

## 📂 Project Structure

```text
├── .env.example           # Template for environment configuration
├── .gitignore             # Git ignore rules for secrets and temporary database locks
├── Dockerfile             # Multi-stage pnpm build & patched runtime container
├── docker-compose.yml     # Container services, networks, and persistent volume mounts
├── install_dsh.sh         # Turnkey bootstrap and deployment script
├── README.md              # Project documentation
├── config/
│   ├── cordis.patch.yml   # LLM provider routing & plugin config overlay
│   ├── settings.yaml      # Agent defaults and UI preferences
│   ├── sync_models.mjs    # Dynamic OpenRouter & Google model synchronizer
│   ├── phoenix/           # Persistent Arize Phoenix SQLite database & traces
│   └── profiles/
│       ├── web/           # Web profile package manifest, lockfiles & MCP config
│       ├── cli/           # Interactive terminal profile
│       └── headless/      # One-shot autonomous CLI runner profile
└── workspaces/            # Mounted directory for your code projects
```

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
