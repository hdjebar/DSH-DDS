# 📚 DeepSeek Harness (DSH-DDS) Documentation Hub

Welcome to the **DeepSeek Harness** documentation hub. This documentation is organized strictly following the **[Diátaxis Framework](https://diataxis.fr/)**, separating learning, practical tasks, understanding, and technical references into dedicated directories.

---

## 🗺️ Journey the Architecture by Visualising It

Rather than relying on static image exports, DSH-DDS features publication-ready, self-contained **interactive HTML web applications** compiled deterministically via **[Archify](https://github.com/tt-a1i/archify)** (`@tt-a1i/archify-dsh`).

### 🚀 Direct Browser Launch
```bash
# 1. Dual-container topology, non-root sandbox & Envoy egress sidecar:
open docs/visual-architecture/system-runtime.architecture.html

# 2. In-line tool interceptor, symlink escape check & GRC audit trail:
open docs/visual-architecture/security-pipeline.workflow.html

# 3. Deterministic step hashing, Invariant 7 loop trap & ACM approval gate:
open docs/visual-architecture/declarative-workflow.workflow.html

# 4. Request lifecycle, AES-256 BYOK vault & local Arize Phoenix waterfall:
open docs/visual-architecture/agent-trace.sequence.html
```

*For complete details, schemas, and CLI commands, see the **[Visual Architecture Suite](visual-architecture/README.md)**.*

---

## 🏛️ Documentation Directory Structure

```
docs/
├── 🚀 getting-started/           [TUTORIALS & EVALUATION]
├── 🛠️ guides/                    [HOW-TO RUNBOOKS]
├── 🏛️ architecture/              [CONCEPTS & SECURITY SPECS]
├── 📚 reference/                 [SCHEMAS, APIS & CATALOGS]
├── 🗺️ visual-architecture/       [INTERACTIVE ARCHIFY SUITE]
├── 📜 adr/                       [ARCHITECTURE DECISION RECORDS]
├── 🔬 future-development/        [ROADMAP & SOTA RESEARCH]
└── 📋 work/                      [AGILE KANBAN WORK HUB]
```

---

## 🧭 Diátaxis Directory Index

### 🚀 1. Getting Started & Evaluation (Tutorials)
Practical learning-oriented walkthroughs to get up and running:
* **[End-to-End Test Scenario](getting-started/testing-scenario.md)** — Step-by-step interactive chat session, Phoenix trace inspection, and persona distillation.
* **[Troubleshooting & Diagnostics](getting-started/troubleshooting.md)** — Diagnostic matrix, Gemini 400 thought-signature resolution, port debugging, and reset procedures.

### 🛠️ 2. Daily Operations & Runbooks (How-To Guides)
Task-oriented recipes for common engineering operations:
* **[Standard Operations & CLI Manual](guides/standard-operations.md)** — Headless scripting, `./dsh.sh` CLI commands, backup/restore, and container management.
* **[Prompt-Driven Customization](guides/customization.md)** — Teaching skills, connecting custom MCP servers, and configuring local model routing.
* **[Upstream Upgrades & Evolution](guides/upgrades.md)** — Cordis microkernel upgrades, plugin evolution, and pnpm patch management.
* **[GitNexus & Archify Workflow Guide](guides/gitnexus-archify.md)** — Coordinated code intelligence, AST knowledge graph navigation, blast radius analysis, and visual governance.

### 🏛️ 3. Architecture & Security Specifications (Explanations)
Theoretical and architectural deep-dives:
* **[System Architecture Overview](architecture/system-overview.md)** — Dual-container topology, kernel proxy, and OTel trace pipelines.
* **[SOTA AI Harness Architecture](architecture/sota-whitepaper.md)** — 5-Pillar SOTA AI Harness whitepaper, NIST AI RMF / EU AI Act alignment, and comparative benchmarks.
* **[Security & Sandbox Guide](architecture/security-model.md)** — Non-root execution (UID 1000), filesystem boundaries, and Zero Trust persona RBAC.
* **[AI Guardrails & OWASP Agentic Security](architecture/guardrails-owasp.md)** — Four deterministic guardrail layers, Invariant 7 loop trap, and OWASP LLM / ASI compliance matrices.
* **[Ecosystem Landscape & Comparison](architecture/ecosystem-analysis.md)** — Comparative architectural analysis against LangGraph, OpenHands, SWE-agent, AutoGen, and CrewAI.
* **[AI Personas Research Note](architecture/research-notes.md)** — Academic foundations and literature on agent specialization and cognitive architectures.

### 📚 4. Technical Reference & Catalogs (Reference)
Authoritative schemas, configurations, and catalogs:
* **[AI Agent Personas Guide](reference/personas.md)** — Declarative persona manifests, YAML schemas, and multi-model task matrices.
* **[Plugins & MCP Reference](reference/plugins.md)** — Active plugins catalog and pre-configured MCP tool suite specifications.
* **[Architecture Decision Records (ADRs)](adr/)** — ADR 0001 through ADR 0008 documenting all foundational design and security decisions.

### 🗺️ 5. Visual Architecture Journey
* **[Visual Architecture Suite](visual-architecture/README.md)** — Interactive HTML models with dark/light themes, pan/zoom canvas, and trace motion.

### 🔬 6. Research & Future Development
* **[Future Development Hub](future-development/README.md)** — Long-term technical roadmap ([ROADMAP.md](future-development/ROADMAP.md)) and enterprise SOTA research report ([SOTA-ResearchReport-ProductionArch.md](future-development/SOTA-ResearchReport-ProductionArch.md)).

### 📋 7. Agile Kanban Work Hub
* **[Agile Kanban Board](work/README.md)** — Master work board tracking backlog epics (`todo/`), active sprints (`in-progress/`), and verified deliverables (`done/`).

---

## 🛠️ Validation & Build Commands

```bash
# Run all 169 unit, integration, and security regression tests:
npm test

# Verify turnkey installer parity with canonical sources:
npm run verify:installer

# Compile all visual architecture diagrams (Showcase Quality):
npm run visual-architecture:build

# Inspect code intelligence index status:
npx gitnexus status
```
