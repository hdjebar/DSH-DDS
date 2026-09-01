# 🧩 DSH Plugins & Model Context Protocol (MCP) Guide

This repository comes pre-packaged with **10 essential, pure English DSH plugins** and **3 pre-configured MCP servers** baked into the container image.

---

## 📦 Pre-Packaged DSH Plugins

### 1. `@liustack/modsearch` (Zero-Cost Web Search)
* **ID**: `modsearch`
* **Purpose**: Provides free, real-time web search capabilities for agents without requiring paid third-party search subscriptions.

### 2. `dsh-find-plugin` (Fast Symbol & File Finder)
* **ID**: `find-dsh-plugin`
* **Purpose**: High-speed fuzzy file finder and code symbol locator across mounted workspaces.

### 3. `dsh-mcp-panel` (MCP Server Manager)
* **ID**: `mcp-panel`
* **Purpose**: Provides visual telemetry and status monitoring for all connected MCP servers and tool registries.

### 4. `dsh-mcp-market` (Visual MCP Marketplace)
* **ID**: `dsh-mcp-market`
* **Purpose**: Interactive catalog for finding and installing Model Context Protocol (MCP) servers with 1-click installation.

### 5. `dsh-provider-model-configurator` (Model Selector)
* **ID**: `dsh-provider-model-configurator`
* **Purpose**: UI-based model and provider management widget to switch models, tune temperature, and set context windows visually.

### 6. `dsh-model-sync` (Quota & Token Monitor)
* **ID**: `model-sync`
* **Purpose**: Visual widget in the bottom toolbar displaying remaining token quota, rate limits, and provider sync status.

### 7. `dsh-mnemon` (Multi-Workspace Persistent Memory)
* **ID**: `mnemon`
* **Purpose**: Provides cross-session indexing and long-term memory for agent conversations and project briefs.

### 8. `dsh-persona-memory` (Long-Term Persona Memory)
* **ID**: `dsh-persona-memory`
* **Purpose**: Manages long-term persona memory files (`MEMORY.md`, `USER.md`), provides `memory_save`/`memory_search` tools, and includes a settings management page.

### 9. `dsh-run2skill` (Session-to-Skill Distiller)
* **ID**: `dsh-run2skill`
* **Purpose**: Automatically turns explicit interactive DSH session runs, tool calls, and refined task steps into reviewable native `SKILL.md` files.

### 10. `dsh-session-reader` (Cross-Session Inspector)
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
* **Commands**: Full GitHub REST API operations (repositories, pull requests, issues, file updates).
* **Authentication**: Powered by `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env`.
