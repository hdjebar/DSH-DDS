# 📋 Epic: External Repository AI Assistant (Host & IDE Tier)

* **Status**: 📋 To Do
* **Target Release**: `v2.1.0`
* **Priority**: High
* **Category**: Agentic Tooling & Developer Experience
* **Architectural Boundary**: **Strictly Outside DSH-DDS System (Host/IDE Tier)**
* **Brainstorm Reference**: [`../backlog/ideation/brainstorm-repo-intelligence-assistant.md`](../backlog/ideation/brainstorm-repo-intelligence-assistant.md)
* **SOTA Research Report**: [`../backlog/ideation/sota-research-external-repo-assistant.md`](../backlog/ideation/sota-research-external-repo-assistant.md)

---

## 🎯 Objective

Provide an authoritative, **external** repository AI assistant operating on the **Host Developer & IDE Tier** (completely outside the sandboxed `DSH-DDS` Docker container stack). The assistant enables human developers and security engineers to intelligently interact with the repository: exploring AST call chains via **GitNexus**, authoring verifiable visual architecture models via **Archify**, verifying ADR invariants, and running pre-commit blast-radius checks safely on the host.

---

## 🛑 Strict Architectural Boundary: Outside the System

* **Never Inside the Container**: Adhering to **[ADR 0007](../../adr/0007-rejection-of-in-container-antigravity-and-credential-isolation.md)** and **ADR 0006**, this assistant **MUST NOT** be implemented as an in-container persona in `config/personas/` or executed within Docker.
* **Separation of Concerns**:
  * **Inside `dsh-dds`**: Untrusted, sandboxed task execution for business domains (SDMX, statistics, data analytics).
  * **Outside `dsh-dds` (Host)**: Privileged repository engineering, code intelligence, refactoring, and governance.

---

## 📋 Scope & Deliverables

1. **Agentic IDE Assistant Skill (`.agents/skills/dsh-repo-assistant/`)**:
   * Package repository intelligence instructions and cheatsheets for pair programmers (Antigravity, Claude Code, Cursor).
   * Encode core invariants: Landlock LSM, non-root execution (UID 1000), ADR 0001–0008, and Diátaxis documentation structure.
   * Provide direct AST navigation workflows using the local GitNexus knowledge graph (2,613 symbols, 77 execution flows).

2. **Host Developer CLI Companion (`./dsh.sh assistant` / `scripts/repo_assistant.mjs`)**:
   * Implement a lightweight, standalone Node.js CLI tool running on the host machine.
   * Subcommands:
     * `./dsh.sh assistant ask "<query>"`: Answer architecture, code, and ADR questions with exact citations.
     * `./dsh.sh assistant review <file>`: Compute AST blast radius and report direct callers/callees using GitNexus.
     * `./dsh.sh assistant verify`: Run pre-commit checks (`npx gitnexus detect-changes`, `npm run verify:installer`, `npm test`).
     * `./dsh.sh assistant build-visuals`: Recompile Archify visual architecture artifacts with showcase validation.

3. **CI/CD Pre-Commit & PR Impact Hook**:
   * Optional Git pre-commit hook executing `npx gitnexus detect-changes` to warn if commits alter unexpected execution flows.

---

## 🛡️ Security & Confinement Invariants

* **Zero Container Footprint**: 0 files added to `config/personas/`, 0 Docker modifications.
* **Host Credential Boundary**: Uses host-scoped environment variables or local LLM keys; credentials never mounted into or shared with the sandboxed container runtime.
* **Preservation of Canonical State**: Proposed code changes must stage in host ephemeral Git worktrees with zero diff on rollback.

---

## 🧪 Acceptance Criteria

- [ ] Repository assistant executes 100% on the host environment; `docker ps` confirms zero additional daemons.
- [ ] Existing 7 in-container domain personas and `tests/personas.test.mjs` remain completely untouched and green.
- [ ] `./dsh.sh assistant ask` and `./dsh.sh assistant review` execute cleanly on host shell.
- [ ] `.agents/skills/dsh-repo-assistant/` validates against IDE skill schema.
- [ ] All 169 automated test suites (`npm test`) continue to pass with 0 regressions.
