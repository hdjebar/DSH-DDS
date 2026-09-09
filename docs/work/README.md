# 📋 DSH-DDS Agile Kanban Work Hub

Welcome to the **Agile Kanban Work Hub** for `DSH-DDS`. This directory manages the engineering lifecycle, sprint backlogs, in-flight technical initiatives, and verified delivery records following modern Agile and Kanban principles.

---

## 📌 Master Kanban Board

```
┌───────────────────┬───────────────────┬───────────────────┬───────────────────┬───────────────────┐
│    💡 BACKLOG     │     📋 TO DO      │  🚧 IN PROGRESS   │    🧪 TESTING     │      ✅ DONE      │
│    (IDEATION)     │   (PRIORITIZED)   │     (SPRINT)      │  (VERIFICATION)   │    (VERIFIED)     │
├───────────────────┼───────────────────┼───────────────────┼───────────────────┼───────────────────┤
│ • External Repo   │ • External Repo   │ • GitNexus &      │ • Quality Gates   │ • Global          │
│   AI Assistant    │   Assistant Epic  │   Archify Visual  │   (Automated 169- │   Refactoring     │
│   (Host/IDE Tier) │   (Host CLI/IDE)  │   Governance      │   suite regression│   (Pillars 1–9)   │
│ • Multi-Tenancy   │ • Temporal Engine │   (Real-time AST  │   & Phoenix evals)│ • Milestone 1     │
│   Partitions      │   (Durable flows) │   visual model)   │                   │   (Envoy Egress)  │
│ • eBPF Syscall    │ • ISO 42001 Kit   │                   │                   │ • Milestone 2     │
│   Auditing Spike  │ • MicroVM Guests  │                   │                   │   (Worktrees)     │
│                   │   (Firecracker)   │                   │                   │ • Milestone 3     │
│                   │                   │                   │                   │   (Sovereign L4)  │
└───────────────────┴───────────────────┴───────────────────┴───────────────────┴───────────────────┘
```

---

### 📋 Detailed Work Breakdown

| Stage | Item / Epic | Target Release | Category | Specification Card |
| :--- | :--- | :---: | :---: | :--- |
| 💡 **Backlog** | **External Repo Assistant Brainstorm (Host Tier)** | `v2.1.0` | Discovery & Spikes | [`backlog/ideation/brainstorm-repo-intelligence-assistant.md`](backlog/ideation/brainstorm-repo-intelligence-assistant.md) |
| 💡 **Backlog** | **SOTA Research: External Repo Assistant** | `v2.1.0` | System Architecture | [`backlog/ideation/sota-research-external-repo-assistant.md`](backlog/ideation/sota-research-external-repo-assistant.md) |
| 💡 **Backlog** | **Backlog & Ideation Hub** | Ongoing | Process | [`backlog/README.md`](backlog/README.md) |
| 🚧 **In Progress** | **September 2026 Security Audit Remediation** | Next security release | Security & Multi-Tenancy | [`in-progress/epic-security-audit-2026-09-remediation.md`](in-progress/epic-security-audit-2026-09-remediation.md) |
| 📋 **To Do** | **External Repo AI Assistant (Host & IDE Tier)** | `v2.1.0` | Developer Tooling | [`todo/epic-repo-intelligence-assistant.md`](todo/epic-repo-intelligence-assistant.md) |
| 📋 **To Do** | **Temporal Durable Execution** | `v2.2.0` | Reliability | [`todo/epic-temporal-durable-execution.md`](todo/epic-temporal-durable-execution.md) |
| 📋 **To Do** | **ISO 42001 & EU AI Act Audit Kit** | `v2.2.0` | Compliance | [`todo/epic-iso-42001-audit-kit.md`](todo/epic-iso-42001-audit-kit.md) |
| 📋 **To Do** | **Firecracker MicroVM Isolation** | `v2.3.0` | Virtualization | [`todo/epic-microvm-firecracker-isolation.md`](todo/epic-microvm-firecracker-isolation.md) |
| 🚧 **In Progress** | **GitNexus & Archify Visual Governance** | `v2.1.0` | Agentic Tooling | [`in-progress/feature-gitnexus-archify-visual-governance.md`](in-progress/feature-gitnexus-archify-visual-governance.md) |
| 🧪 **Testing** | **Quality Gates & Regression Gate** | Continuous | Quality Assurance | [`testing/README.md`](testing/README.md) |
| ✅ **Done** | **Global Architecture Refactoring** | `v1.10.0` | Core Kernel | [`done/global-refactoring/README.md`](done/global-refactoring/README.md) |
| ✅ **Done** | **Milestone 1: Egress Proxy & Failover** | `v1.11.0` | Security & Net | [`done/milestone-1-zero-trust-egress.md`](done/milestone-1-zero-trust-egress.md) |
| ✅ **Done** | **Milestone 2: Git Worktrees & Evals** | `v1.12.0` | State & Evals | [`done/milestone-2-transactional-evals.md`](done/milestone-2-transactional-evals.md) |
| ✅ **Done** | **Milestone 3: Level 4.0 Sovereign Harness** | `v2.0.0` | High-Assurance | [`done/milestone-3-sovereign-harness.md`](done/milestone-3-sovereign-harness.md) |

---

## 📐 Kanban Operating Principles

### 1. The 5-Stage Engineering Lifecycle
1. **💡 Backlog (`backlog/`)**: Brainstorming, ideation briefs (`backlog/ideation/`), technology feasibility spikes, and exploratory architecture proposals.
2. **📋 To Do (`todo/`)**: Prioritized Epics with validated scopes and technical acceptance criteria ready for implementation.
3. **🚧 In Progress (`in-progress/`)**: Active implementation sprint. Strictly capped at **maximum 3 active features** simultaneously to maintain focus and prevent delivery bottlenecks.
4. **🧪 Testing (`testing/`)**: Quality gate verification. Automated regression testing (`npm test`), installer sync (`verify:installer`), visual architecture certification (`visual-architecture:build`), and LLM trajectory evals (`tests/phoenix-evals.test.mjs`).
5. **✅ Done (`done/`)**: Production-ready, verified deliverables with merged code, zero regressions, and updated Diátaxis documentation.

### 2. Definition of Ready (DoR)
A task or epic can graduate from `backlog/` to `todo/` and into `in-progress/` only when:
* Objective, scope, and technical acceptance criteria are clearly defined.
* Security impact and architectural boundaries (e.g. Landlock LSM, non-root UID 1000, ADR invariants) are vetted.
* Dependencies (APIs, tools, container profiles) are identified.

### 3. Definition of Done (DoD)
A task or epic can graduate from `testing/` to `done/` only when:
* Code implementation is complete, non-breaking, and adheres to non-root execution guidelines.
* All Five Quality Gates pass (169/169 tests, installer parity, visual models compiled, AST checks).
* GitNexus pre-commit check (`npx gitnexus detect-changes`) passes with zero unmapped symbol mutations.
* Core documentation, CHANGELOG, and ADR references are updated.

---

## 🔗 Related Documentation
* [System Architecture Overview](../architecture/system-overview.md)
* [Architecture Decision Records (ADRs)](../adr/)
* [AI Guardrails & OWASP Architecture](../architecture/guardrails-owasp.md)
* [Visual Architecture Journey](../visual-architecture/README.md)
