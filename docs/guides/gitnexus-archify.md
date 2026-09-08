# 🧠 Coordinated Code Intelligence & Architecture Visualization: GitNexus + Archify

This guide documents the coordinated workflow between **GitNexus** (code knowledge graph & blast-radius analysis) and **Archify** (interactive architecture & workflow visualization) within **DeepSeek Harness (DSH-DDS)** and agentic coding environments like **Antigravity**.

---

## 🏗️ Architectural Overview

When paired, GitNexus and Archify solve the two biggest challenges in AI-assisted development: **structural understanding** and **verifiable architectural communication**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              ANTIGRAVITY                               │
│         (Agentic Orchestrator: Planning, Editing, Code Changes)        │
└───────────────▲────────────────────────────────────────▲───────────────┘
                │ [1] AST & Call Graphs (MCP)            │ [2] JSON IR to SVG/HTML
                │                                        │
        ┌───────┴────────┐                       ┌───────┴────────┐
        │   GitNexus     │                       │    Archify     │
        │  (The "Brain") │                       │(The "Visualizer")│
        └────────────────┘                       └────────────────┘
         Tree-sitter AST                          Typed JSON IR
         Symbol Call Graphs                       Schema Validation
         Blast Radius Analysis                    Standalone HTML/SVG
         Local SQLite / DuckDB                    Interactive Inspector
```

| Dimension | **GitNexus** | **Archify** |
| :--- | :--- | :--- |
| **Role** | Ground-truth code intelligence | Verifiable visual architecture |
| **Engine** | Tree-sitter AST & relational knowledge graph | JSON IR compiler with SVG renderer |
| **Agent Interface** | Model Context Protocol (MCP) server & CLI | Agent skill (`.agents/skills/archify`) |
| **Key Output** | Callers, callees, execution flows, blast radius | Self-contained interactive HTML/SVG diagrams |
| **Privacy** | 100% local / zero-server | 100% local / zero-server |

---

## ⚙️ Setup & Configuration

### 1. GitNexus CLI & MCP Setup

GitNexus is configured to index the repository locally into `.gitnexus/` (ignored in `.gitignore`):

```bash
# Index or re-index the repository
npx -y gitnexus analyze .

# Check index status
npx -y gitnexus status
```

#### Antigravity MCP Server (`~/.gemini/config/mcp_config.json`)
Expose GitNexus to Antigravity so the agent can query symbols and relationships:

```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus", "mcp"]
    }
  }
}
```

### 2. Archify Skill Setup

Archify is installed in the project root under [.agents/skills/archify/](file:///Users/hdjebar/dshdds-imp/.agents/skills/archify):

```bash
npx skills add tt-a1i/archify --yes
```

This installs:
* Typed JSON schemas: `schemas/architecture.schema.json`, `schemas/workflow.schema.json`, `schemas/sequence.schema.json`, `schemas/dataflow.schema.json`, `schemas/lifecycle.schema.json`.
* Standalone rendering engine: `bin/archify.mjs`.

---

## 🔄 The 5-Step Coordinated Workflow

### Step 1: Symbol & Context Discovery (GitNexus)
Before modifying or refactoring any core module, the agent queries GitNexus for symbol context rather than scanning files with grep:

```bash
# Inspect symbol callers, callees, and participating execution flows
npx gitnexus context registerRbacInterceptor
```

*Example Output:*
* Incoming callers: `tests/multi_user.test.mjs`, `tests/core_plugin.test.mjs`
* Outgoing dependencies: `preExecuteWaterfall`, `UserPartitionManager`, `isInside`
* Execution processes: `RegisterRbacInterceptor ➔ SanitizeUserId`, `RegisterRbacInterceptor ➔ ResolvePath`

### Step 2: Impact Analysis / Blast Radius (GitNexus)
Determine the risk level and all affected modules before touching code:

```bash
npx gitnexus impact user-partition.js
```
* Returns affected modules, caller depth, and risk rating (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
* Alerts the developer if a critical boundary is breached.

### Step 3: Synthesis into Archify JSON IR (Agent)
Using verified graph facts from GitNexus, the agent authors or updates a typed Archify JSON specification (e.g., in `docs/diagrams/`):

```json
{
  "schema_version": 1,
  "diagram_type": "architecture",
  "meta": {
    "title": "DSH-DDS Zero-Trust Governance Pipeline",
    "quality_profile": "showcase"
  },
  "components": [
    { "id": "gw", "type": "security", "label": "WebServer Gateway", "sublabel": "@dsh-dds/core", "pos": [250, 300], "size": [160, 60] },
    { "id": "pep", "type": "security", "label": "In-Line PEP", "sublabel": "Dynamic RBAC", "pos": [480, 300], "size": [160, 60] },
    { "id": "vault", "type": "security", "label": "BYOK Keystore", "sublabel": "AES-256-GCM Vault", "pos": [480, 150], "size": [160, 60] },
    { "id": "llm", "type": "cloud", "label": "Model Providers", "sublabel": "Gemini & OpenRouter", "pos": [710, 300], "size": [160, 60] }
  ],
  "connections": [
    { "id": "gw-pep", "from": "gw", "to": "pep", "label": "Tool Exec", "variant": "emphasis" },
    { "id": "pep-vault", "from": "pep", "to": "vault", "label": "Resolve Key", "variant": "security", "fromSide": "top", "toSide": "bottom" },
    { "id": "pep-llm", "from": "pep", "to": "llm", "label": "Egress API", "variant": "emphasis" }
  ]
}
```

### Step 4: Validate & Compile Interactive Diagrams (Archify)
Compile the intermediate representation into an interactive HTML/SVG artifact:

```bash
# Validate against schemas and quality constraints
node .agents/skills/archify/bin/archify.mjs validate architecture \
  docs/diagrams/system-runtime.architecture.json --quality standard --json

# Render standalone interactive HTML
node .agents/skills/archify/bin/archify.mjs render architecture \
  docs/diagrams/system-runtime.architecture.json \
  docs/diagrams/system-runtime.architecture.html --quality standard
```

Generated diagrams include:
* Full pan/zoom and node inspection.
* Dynamic theme switching (Dark / Light mode).
* High-res export to PNG, SVG, or WebM video.

### Step 5: Verification & Safety Guard (GitNexus)
Before staging or committing any code changes, verify that the git diff only affects expected symbols and execution flows:

```bash
npx gitnexus detect-changes
```
* Ensures no unexpected side effects or unmapped symbol mutations.

---

## 📋 Command Cheat Sheet

| Task | Tool | Command |
| :--- | :--- | :--- |
| **Index repository** | GitNexus | `npx gitnexus analyze .` |
| **Check index freshness** | GitNexus | `npx gitnexus status` |
| **Find symbol context** | GitNexus | `npx gitnexus context <symbolName>` |
| **Check blast radius** | GitNexus | `npx gitnexus impact <symbolOrFile>` |
| **Search execution flows** | GitNexus | `npx gitnexus query "<concept>"` |
| **Pre-commit safety check**| GitNexus | `npx gitnexus detect-changes` |
| **Validate diagram IR** | Archify | `node .agents/skills/archify/bin/archify.mjs validate <type> <file.json>` |
| **Render HTML diagram** | Archify | `node .agents/skills/archify/bin/archify.mjs render <type> <file.json> <file.html>` |
| **Deliver final diagram** | Archify | `node .agents/skills/archify/bin/archify.mjs deliver <type> <file.json> <file.html>` |

---

## 🔗 Related Resources
* [Archify Diagrams Directory](file:///Users/hdjebar/dshdds-imp/docs/diagrams/README.md)
* [System Runtime Diagram](file:///Users/hdjebar/dshdds-imp/docs/diagrams/system-runtime.architecture.html)
* [Agent Trace Sequence Diagram](file:///Users/hdjebar/dshdds-imp/docs/diagrams/agent-trace.sequence.html)
* [Agent Guidelines (AGENTS.md)](file:///Users/hdjebar/dshdds-imp/AGENTS.md)
