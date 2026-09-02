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

### 10. `deepseek-flow` (Visual Canvas Workflow Designer)
* **ID**: `deepseek-flow`
* **Purpose**: Interactive visual drag-and-drop workflow canvas for Web UI with Boolean condition gates, DAG execution, and bi-directional `WORKFLOW.md` / `STEP.md` synchronization.

---

## 🔌 Pre-Configured Model Context Protocol (MCP) Servers

All Model Context Protocol (MCP) servers are pre-installed directly into the container image to guarantee zero-network runtime execution, predictable cold-starts, and supply-chain integrity (no `npx -y` dynamic fetching):

### 1. `mcp-fetch` (`@mzxrai/mcp-webresearch@0.1.7`)
* **Transport**: `stdio` (`mcp-server-webresearch`)
* **Capabilities**: `fetch(url)` — Extracts clean markdown and structured summaries from any public web page or technical documentation site.

### 2. `mcp-context7` (`@upstash/context7-mcp@1.0.14`)
* **Transport**: `stdio` (`context7-mcp`)
* **Capabilities**: Up-to-date SDK and library documentation retrieval for developer frameworks.

### 3. `mcp-github` (`github-mcp-server:v1.11.0`)
* **Transport**: `stdio` (`github-mcp-server stdio`)
* **Source**: Official maintained GitHub MCP Server (`github/github-mcp-server:v1.11.0`) embedded as a native binary.
* **Capabilities**: Full GitHub REST API operations (repositories, branches, pull requests, issues, file updates).
* **Authentication**: Environment variable indirection via `${GITHUB_PERSONAL_ACCESS_TOKEN}`.

### 4. `sqlite-db` (`mcp-server-sqlite@2025.4.25`)
* **Transport**: `stdio` (`uvx mcp-server-sqlite@2025.4.25 --db-path /workspaces/data.db`)
* **Capabilities**: Relational SQL querying, schema inspection, and metric aggregations across tabular datasets.
