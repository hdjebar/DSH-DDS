# 🚀 DeepSeek Harness (DSH) — Docker Deployment Stack

[![Docker](https://img.shields.io/badge/Docker-24.0+-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![pnpm](https://img.shields.io/badge/pnpm-11+-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An optimized, lightweight, production-ready Docker deployment stack for **DeepSeek Harness (DSH)** featuring a **pnpm multi-stage build**, dual **Google Gemini + OpenRouter** LLM architecture, automated log rotation, and pre-packaged productivity plugins.

---

## ✨ Features

- **⚡ Multi-Stage Lightweight Image**: Two-stage Docker build utilizing `pnpm` for native compilation (`node-pty`) while stripping all build toolchains and caches in the final image (writable layer $< 1\text{ MB}$).
- **🤖 Dual LLM Provider Support**:
  - **Google AI Studio (Gemini)**: Pre-configured for `gemini-3.7-flash` (default) and `gemini-3.1-pro`.
  - **OpenRouter**: Pre-configured for `deepseek/deepseek-chat` (V3), `openai/gpt-4o`, and `anthropic/claude-3.5-sonnet`.
- **🧩 Pre-Installed Plugin Suite**: Includes 9 essential DSH plugins and 3 pre-configured MCP servers (Web Research, Context7 Docs, and GitHub).
- **🛒 Dynamic UI Plugin Installation**: Retains `pnpm` runtime integration so additional extensions can be installed directly through the Web UI without container rebuilds.
- **🛡️ Production Hardened**: Automated Docker health checks, log rotation limits (`10MB` max, `3` files), and isolated volume mounts.

---

## 📦 Pre-Packaged Plugins & MCP Servers

### 1. DSH Plugins (9 Pre-Installed)

| Plugin | Service ID | Purpose |
| :--- | :--- | :--- |
| **`dshmarket`** | `dsh-market` | Plugin Marketplace & Extensions Hub |
| **`@liustack/modsearch`** | `modsearch` | Integrated web search provider |
| **`dsh-better-sidebar`** | `better-sidebar` | VS Code-style sidebar with persistent terminal |
| **`dsh-find-plugin`** | `find-dsh-plugin` | Workspace file and symbol finder |
| **`dsh-mcp-market`** | `dsh-mcp-market` | Visual MCP Server Marketplace with 1-click install |
| **`dsh-mcp-panel`** | `mcp-panel` | Model Context Protocol (MCP) management panel |
| **`dsh-provider-model-configurator`** | `dsh-provider-model-configurator` | Visual LLM provider and model manager |
| **`dsh-model-sync`** | `model-sync` | Automated model sync and quota monitor widget |
| **`dsh-mnemon`** | `mnemon` | Multi-workspace memory persistence & indexing |

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
git clone https://github.com/YOUR_USERNAME/dsh-docker.git
cd dsh-docker
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and insert your API keys:
```bash
cp .env.example .env
```

Edit `.env`:
```env
DSH_PORT=3080
GEMINI_API_KEY=your_google_ai_studio_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
GITHUB_PERSONAL_ACCESS_TOKEN=your_github_token
PHOENIX_API_KEY=your_optional_phoenix_key
```

### 3. Deploy Stack

#### Option A: Turnkey Script (Supports Separating Boot & Target Directories)

You can choose where DeepSeek Harness should be installed:

- **Separate Installation Directory** (e.g. `$HOME/dsh` or `/opt/dsh`):
  ```bash
  # 1. Set your target installation path
  export DSH_INSTALL="$HOME/dsh"

  # 2. Run installer from this repository (boot folder)
  chmod +x install_dsh.sh
  ./install_dsh.sh

  # 3. Move to your installation folder and boot
  cd "$DSH_INSTALL"
  docker compose up -d --build
  ```

- **In-Place Deployment** (Default — installs in current repository folder):
  ```bash
  chmod +x install_dsh.sh
  ./install_dsh.sh
  docker compose up -d --build
  ```

#### Option B: Direct Docker Compose
```bash
docker compose up -d --build
```

### 4. Access Web Interfaces

* **DeepSeek Harness Web UI**:
  👉 **[http://localhost:3080](http://localhost:3080)**

* **Arize Phoenix Telemetry & Traces Dashboard**:
  👉 **[http://localhost:6006](http://localhost:6006)**
  *(Visualizes agent execution graphs, LLM latency percentiles, token usage, and tool calling waterfalls locally)*

---

## 📂 Project Structure

```text
├── .env.example           # Example environment file
├── .gitignore             # Git ignore rules for secrets and caches
├── Dockerfile             # Multi-stage pnpm build & runtime definition
├── docker-compose.yml     # Container services & volume configuration
├── install_dsh.sh         # Turnkey installation & bootstrap script
├── README.md              # Project documentation
├── config/
│   ├── cordis.patch.yml   # LLM provider & plugin configuration patch
│   └── profiles/
│       └── web/           # Web profile package manifest & lockfiles
└── workspaces/            # Mounted directory for your code projects
```

---

## 🛠️ Management & Operations

### View Real-Time Logs
```bash
docker compose logs -f
```

### Restart Service
```bash
docker compose restart
```

### Stop Service
```bash
docker compose down
```

### Rebuild Image After Upgrades
```bash
docker compose up -d --build
```

### Adding New Plugins
- **Via Web UI**: Open the web application $\rightarrow$ click **Marketplace (`dshmarket`)** $\rightarrow$ Click **Install**.
- **Via CLI**:
  ```bash
  docker compose exec dsh dsh plugin --profile web add <plugin_name>
  docker compose restart
  ```

---

## 🔒 Security Best Practices

- Never commit your `.env` file to source control.
- Ensure API keys have appropriate usage caps configured in their respective developer consoles ([Google AI Studio](https://aistudio.google.com/) / [OpenRouter](https://openrouter.ai/)).

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
