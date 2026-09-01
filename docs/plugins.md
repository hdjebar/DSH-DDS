# 🧩 DSH Plugins & Model Context Protocol (MCP) Guide

This repository comes pre-packaged with 9 essential DSH plugins and 3 pre-configured MCP servers baked into the container image.

---

## 📦 Pre-Packaged DSH Plugins

### 1. `dshmarket` (Visual Plugin Marketplace)
* **ID**: `dsh-market`
* **Purpose**: Allows discovering, browsing, and installing community and official DSH plugins directly from the web interface.
* **Usage**: Click the Marketplace icon in the left navigation sidebar.

### 2. `@liustack/modsearch` (Zero-Cost Web Search)
* **ID**: `modsearch`
* **Purpose**: Provides free, real-time web search capabilities for agents without requiring paid third-party search subscriptions.

### 3. `dsh-better-sidebar` (VS Code Classic Layout)
* **ID**: `better-sidebar`
* **Purpose**: Adds an integrated VS Code-style sidebar with collapsible trees, active sessions, and persistent terminal tabs.

### 4. `dsh-find-plugin` (Fast Symbol & File Finder)
* **ID**: `find-dsh-plugin`
* **Purpose**: High-speed fuzzy file finder and code symbol locator across mounted workspaces.

### 5. `dsh-mcp-market` (Visual MCP Marketplace)
* **ID**: `dsh-mcp-market`
* **Purpose**: Interactive catalog for finding and installing Model Context Protocol (MCP) servers with 1-click installation.

### 6. `dsh-mcp-panel` (MCP Server Manager)
* **ID**: `mcp-panel`
* **Purpose**: Provides visual telemetry and status monitoring for all connected MCP servers and tool registries.

### 7. `dsh-provider-model-configurator`
* **ID**: `dsh-provider-model-configurator`
* **Purpose**: UI-based model and provider management widget to switch models, tune temperature, and set context windows visually.

### 8. `dsh-model-sync` (Quota & Token Monitor)
* **ID**: `model-sync`
* **Purpose**: Visual widget in the bottom toolbar displaying remaining token quota, rate limits, and provider sync status.

### 9. `dsh-mnemon` (Multi-Workspace Persistent Memory)
* **ID**: `mnemon`
* **Purpose**: Provides cross-session indexing and long-term memory for agent conversations and project briefs.

### 10. `dsh-run2skill` (Session-to-Skill Distiller)
* **ID**: `dsh-run2skill`
* **Purpose**: Automatically turns explicit interactive DSH session runs, tool calls, and refined task steps into reviewable native `SKILL.md` files.

### 11. `@mhw12138/dsh-ui-better-sidebar-skill` (Skill & Persona Studio)
* **ID**: `dsh-ui-better-sidebar-skill`
* **Purpose**: Adds an interactive Skill & Persona Studio tab inside the right sidebar of the Web UI to browse, preview, edit, create, and delete skills live.

### 12. `dsh-persona-memory` (Long-Term Persona Memory)
* **ID**: `dsh-persona-memory`
* **Purpose**: Manages long-term persona memory files (`MEMORY.md`, `USER.md`), provides `memory_save`/`memory_search` tools, and includes a settings management page.

### 13. `@sunjuntao/dsh-prompt-library` (Prompt Vault & Session Clipper)
* **ID**: `dsh-prompt-library`
* **Purpose**: Interactive prompt library above the composer: CRUD management, prompt tagging, and 1-click text clipping from active sessions.

### 14. `dsh-prompt-customizer` (System Prompt & Tool Customizer)
* **ID**: `dsh-prompt-customizer`
* **Purpose**: Visual UI panel to inject/replace system prompt sections and customize active tool rosters per task.

### 15. `dsh-session-reader` (Cross-Session Inspector)
* **ID**: `dsh-session-reader`
* **Purpose**: Allows agents and personas to read prior session contents, thinking processes, and tool responses to synthesize workflows.

---

## 🔌 Pre-Configured MCP Servers

The following MCP servers are configured in `config/profiles/web/cordis.patch.yml`:

### 1. `mcp-fetch` (`@mzxrai/mcp-webresearch`)
* **Commands**: `fetch(url)`
* **Description**: Extracts clean markdown and summaries from any public web page or documentation site.

### 2. `mcp-context7` (`@upstash/context7-mcp`)
* **Commands**: Real-time SDK and library documentation retrieval.
* **Description**: Delivers up-to-date documentation for hundreds of developer libraries directly to the agent.

### 3. `mcp-github` (`@modelcontextprotocol/server-github`)
* **Commands**: Repositories, PRs, issues, commits, branch management, file diffs.
* **Authentication**: Powered by `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env`.

---

## 🛠️ Adding New Plugins Dynamically

You can install additional plugins either via the Web UI Marketplace (`dshmarket`) or via CLI:

```bash
# Add a plugin to the web profile
docker compose exec dsh dsh plugin --profile web add <plugin-name>

# Restart container to apply
docker compose restart dsh
```
