# 📋 Epic: In-Repository AI Assistant (`codebase-architect`)

* **Status**: 📋 To Do
* **Target Release**: `v2.1.0`
* **Priority**: High
* **Category**: Agentic Tooling & Developer Experience
* **Brainstorm Reference**: [`../backlog/ideation/brainstorm-repo-intelligence-assistant.md`](../backlog/ideation/brainstorm-repo-intelligence-assistant.md)

---

## 🎯 Objective

Provide an authoritative, in-repository AI assistant that enables developers, architects, and auditors to intelligently interact with `DSH-DDS`. The assistant combines **GitNexus AST code intelligence** (2,613 symbols, 77 execution flows), **Archify visual architecture compilation**, and local **Arize Phoenix trace telemetry** to explain architecture, analyze blast radiuses, answer ADR questions, and safely propose code modifications.

---

## 📋 Scope & Deliverables

1. **`codebase-architect` Persona (`config/personas/codebase-architect/`)**:
   * Author declarative `persona.yaml` and `SKILL.md` defining the resident codebase architect.
   * Configure model routing matrix: Gemini 2.5 Flash for rapid AST lookups, DeepSeek R1 / Claude 3.7 Sonnet for complex architectural reasoning.
   * Zero-Trust RBAC: Read-only access over `/app`, `/workspaces`, and `/etc/dsh`; writes restricted to ephemeral worktrees.

2. **GitNexus MCP Toolchain Integration**:
   * Expose `gitnexus_query`, `gitnexus_context`, and `gitnexus_impact` to the persona's tool execution matrix.
   * Enable real-time blast-radius calculation for any requested code mutation.

3. **Terminal Companion (`./dsh.sh ask` / `./dsh.sh review`)**:
   * Add `./dsh.sh ask "<prompt>"` CLI command for fast terminal queries against the local model bridge.
   * Add `./dsh.sh review <file_or_symbol>` to report upstream/downstream callers and risk rating directly in stdout.

4. **Archify Visual Compilation On-Demand**:
   * Provide capability adapter enabling the assistant to compile or update visual architecture diagrams (`npm run visual-architecture:build`) during interactive sessions.

5. **Agentic IDE Skill (`.agents/skills/dsh-assistant/`)**:
   * Document and package repo-level guidelines, ADR invariants, non-root rules, and pre-commit verification workflows.

---

## 🛡️ Security & Confinement Invariants

* **Fail-Closed RBAC**: The assistant operates under unprivileged non-root execution (UID 1000) and cannot execute arbitrary host bash commands outside declared capability adapters.
* **Ephemeral Worktree Staging**: Any proposed code modifications must stage in isolated Git worktrees (`config/worktree-staging.mjs`) with automated rollback on test failures.
* **Air-Gapped Telemetry**: All assistant queries, reasoning steps, and tool invocations record locally to Arize Phoenix (`127.0.0.1:6006`) with zero external trace leakage.

---

## 🧪 Acceptance Criteria

- [ ] `codebase-architect` persona manifest passes all persona architecture validation tests (`tests/personas.test.mjs`).
- [ ] Persona demonstrates accurate symbol lookups and blast-radius reports using GitNexus MCP tools.
- [ ] `./dsh.sh ask` functions headlessly without browser dependency.
- [ ] Automated regression tests added under `tests/repo_assistant.test.mjs` verifying fail-closed RBAC containment.
- [ ] All existing 169 tests continue to pass with 0 regressions.
