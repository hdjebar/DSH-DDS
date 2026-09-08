# 📋 DSH-DDS Agile Kanban Work Hub

Welcome to the **Agile Kanban Work Hub** for `DSH-DDS`. This directory manages the engineering lifecycle, sprint backlogs, in-flight technical initiatives, and verified delivery records following modern Agile and Kanban principles.

---

## 📌 Master Kanban Board

```
┌─────────────────────────────────┬─────────────────────────────────┬─────────────────────────────────┐
│        📋 TO DO (BACKLOG)       │     🚧 IN PROGRESS (SPRINT)     │       ✅ DONE (VERIFIED)        │
├─────────────────────────────────┼─────────────────────────────────┼─────────────────────────────────┤
│ • Temporal Durable Execution    │ • GitNexus & Archify Visual     │ • Global Refactoring (Pillars   │
│   (Resilient multi-day flows)   │   Governance (Real-time code    │   1–9, UID 1000, @dsh-dds/core) │
│ • ISO 42001 & EU AI Act Audit   │   intelligence & AST diagrams)  │ • Milestone 1 (v1.11.0: Envoy   │
│   Evidence Kit (Signed reports) │                                 │   egress, model failover)       │
│ • Firecracker MicroVM Isolation │                                 │ • Milestone 2 (v1.12.0: Git     │
│   (Hardware-virtualized guest)  │                                 │   worktrees, Phoenix evals)     │
│                                 │                                 │ • Milestone 3 (v2.0.0: Level    │
│                                 │                                 │   4.0 Context quarantine)       │
└─────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

---

### 📋 Detailed Work Breakdown

| State | Item / Epic | Target Release | Category | Specification Card |
| :--- | :--- | :---: | :---: | :--- |
| 📋 **To Do** | **Temporal Durable Execution** | `v2.2.0` | Reliability | [`todo/epic-temporal-durable-execution.md`](todo/epic-temporal-durable-execution.md) |
| 📋 **To Do** | **ISO 42001 & EU AI Act Audit Kit** | `v2.2.0` | Compliance | [`todo/epic-iso-42001-audit-kit.md`](todo/epic-iso-42001-audit-kit.md) |
| 📋 **To Do** | **Firecracker MicroVM Isolation** | `v2.3.0` | Virtualization | [`todo/epic-microvm-firecracker-isolation.md`](todo/epic-microvm-firecracker-isolation.md) |
| 🚧 **In Progress** | **GitNexus & Archify Visual Governance** | `v2.1.0` | Agentic Tooling | [`in-progress/feature-gitnexus-archify-visual-governance.md`](in-progress/feature-gitnexus-archify-visual-governance.md) |
| ✅ **Done** | **Global Architecture Refactoring** | `v1.10.0` | Core Kernel | [`done/global-refactoring/README.md`](done/global-refactoring/README.md) |
| ✅ **Done** | **Milestone 1: Egress Proxy & Failover** | `v1.11.0` | Security & Net | [`done/milestone-1-zero-trust-egress.md`](done/milestone-1-zero-trust-egress.md) |
| ✅ **Done** | **Milestone 2: Git Worktrees & Evals** | `v1.12.0` | State & Evals | [`done/milestone-2-transactional-evals.md`](done/milestone-2-transactional-evals.md) |
| ✅ **Done** | **Milestone 3: Level 4.0 Sovereign Harness** | `v2.0.0` | High-Assurance | [`done/milestone-3-sovereign-harness.md`](done/milestone-3-sovereign-harness.md) |

---

## 📐 Kanban Operating Principles

### 1. Work-in-Progress (WIP) Limits
* **In Progress Cap**: Maximum **3 active features** simultaneously to maintain focus and prevent delivery bottlenecks.
* **Review / Quality Gate**: Every item transitioning to `done/` must pass all test suites (`npm test`) with 0 regressions.

### 2. Definition of Ready (DoR)
A task or epic can move from `todo/` to `in-progress/` only when:
* Objective, scope, and technical acceptance criteria are clearly defined.
* Security impact and architectural boundaries (e.g. ADR requirements) are vetted.
* Dependencies (APIs, tools, container profiles) are identified.

### 3. Definition of Done (DoD)
A task or epic can move from `in-progress/` to `done/` only when:
* Code implementation is complete, non-breaking, and adheres to non-root execution guidelines.
* Unit and integration test coverage is added under `tests/` with 100% pass rate (`npm test`).
* GitNexus impact and pre-commit check (`npx gitnexus detect-changes`) passes with zero unmapped symbol mutations.
* Core documentation and ADR references are updated.

---

## 🔗 Related Documentation
* [System Architecture Overview](../architecture.md)
* [Architecture Decision Records (ADRs)](../adr/)
* [AI Guardrails & OWASP Architecture](../guardrails.md)
* [Archify Interactive Architecture Suite](../diagrams/README.md)
