# 🧩 DSH Plugins & Model Context Protocol (MCP) Guide

This repository comes pre-packaged with **9 essential, pure English DSH plugins** and **3 pre-configured MCP servers** baked into the container image.

---

## 📦 Pre-Packaged DSH Plugins

### 1. `@liustack/modsearch` (Zero-Cost Web Search)
* **ID**: `modsearch`
* **Purpose**: Provides free, real-time web search capabilities for agents without requiring paid third-party search subscriptions.

### 2. `dshmarket` (Visual Plugin Marketplace — English Localized)
* **ID**: `dsh-market`
* **Purpose**: Visual catalog to discover, search, and 1-click install community plugins directly within the web interface.

### 3. `dsh-find-plugin` (Fast Symbol & File Finder)
* **ID**: `find-dsh-plugin`
* **Purpose**: High-speed fuzzy file finder and code symbol locator across mounted workspaces.

### 4. `dsh-mcp-panel` (MCP Server Manager)
* **ID**: `mcp-panel`
* **Purpose**: Provides visual telemetry and status monitoring for all connected MCP servers and tool registries.

### 5. `dsh-mcp-market` (Visual MCP Marketplace)
* **ID**: `dsh-mcp-market`
* **Purpose**: Interactive catalog for finding and installing Model Context Protocol (MCP) servers with 1-click installation.

### 6. `dsh-provider-model-configurator` (Model Selector)
* **ID**: `dsh-provider-model-configurator`
* **Purpose**: UI-based model and provider management widget to switch models, tune temperature, and set context windows visually.

### 7. `dsh-model-sync` (Quota & Token Monitor)
* **ID**: `model-sync`
* **Purpose**: Visual widget in the bottom toolbar displaying remaining token quota, rate limits, and provider sync status.

### 8. `dsh-mnemon` (Unified Multi-Workspace Memory System)
* **ID**: `mnemon`
* **Purpose**: Provides a unified 3-tier memory engine (Runtime context, Project archives, and Memory Spaces) with cross-session recall.

### 9. `dsh-session-reader` (Cross-Session Inspector)
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
