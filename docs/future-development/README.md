# 🚀 Future Development & Production Architecture Hub

Welcome to the **Future Development Hub** of `DSH-DDS` (DeepSeek Harness & Dual-Model Development Stack).

This directory houses the foundational research, capability maturity audits, engineering roadmaps, and architectural blueprints guiding the evolution of `DSH-DDS` from a **Governed Production Harness (Level 3.1)** toward a **High-Assurance Sovereign AI Harness (Level 4.0)**.

---

## 🧭 Navigation & Document Index

| Document | Primary Focus | Target Audience |
| :--- | :--- | :--- |
| 📜 **[Engineering Roadmap & Sprints](ROADMAP.md)** | Phased milestones (**v1.11.0**, **v1.12.0**, **v2.0.0**), dual-container task breakdowns (`dsh` + `phoenix`), issue checklists, and release gates. | Core Developers, Maintainers |
| 🏛️ **[SOTA Research Report & Architecture Blueprint](SOTA-ResearchReport-ProductionArch.md)** | 1,029-line master audit: 5-level Capability Maturity Model, 17-layer harness audit, threat models, and Node.js Cordis blueprints. | Systems Architects, Security Auditors |

---

## 📊 Capability Maturity Scorecard (`v1.10.0+ Antigravity Edition`)

`DSH-DDS` is evaluated against a 5-level Capability Maturity Model aligned with standard systems engineering frameworks (CMMI, SLSA, and NIST AI RMF):

```
Level 0: Non-Harnessed       -> Raw scripts, unmanaged loops, direct host OS exposure.
Level 1: Container Sandbox   -> Basic Docker encapsulation, unconstrained bash shells.
Level 2: Modular Harness     -> Multi-provider keys, plugins, persona decoupling.
Level 3: Governed Harness    -> Typed MCP tools, read-only sandbox, OTel tracing. [CURRENT: Level 3.10 / 4.0]
Level 4: High-Assurance      -> MicroVMs (Firecracker/gVisor), Dual-LLM quarantine, Temporal state.
```

### Current Status: **Level 3.10 / 4.0 (Governed Production-Grade Harness)**

```
+--------------------------------------------------------------------------------------------------+
| DIMENSION                     SCORE       OPERATIONAL POSTURE & VERIFIED CAPABILITY              |
+--------------------------------------------------------------------------------------------------+
  1. Architecture                3.3 / 4.0   Node.js 24 / Cordis ESM microkernel; declarative engine.
  2. Security & Containment      3.3 / 4.0   Immutable rootfs, cap_drop: ALL, cgroups, Landlock LSM.
  3. Tool Governance             3.2 / 4.0   4 pre-compiled MCP servers; Google Antigravity (agy).
  4. State & Memory              2.2 / 4.0   Clean host-bind mounts; GRC audit log; needs Git CoW.
  5. Reliability & Resilience    2.7 / 4.0   Dynamic model switching; needs in-flight 429 failover.
  6. Observability & Tracing     3.5 / 4.0   Arize Phoenix 20.5.0 on :6006; 128-bit OTel span trees.
  7. Testing & Evaluation        3.0 / 4.0   48 automated tests in tests/ via native node:test.
  8. Deployment Operations       3.1 / 4.0   Pinned node:24-bookworm-slim, SHA256 digests, clean CLI.
  9. Documentation               3.3 / 4.0   5 ADRs (0001–0005), comprehensive architectural guides.
+--------------------------------------------------------------------------------------------------+
  OVERALL MATURITY RATING        3.10 / 4.0  LEVEL 3: GOVERNED PRODUCTION-GRADE HARNESS
+--------------------------------------------------------------------------------------------------+
```

---

## 🏛️ Dual-Container Architectural Topology

`DSH-DDS` operates as a cohesive dual-container stack:

```
                      DSH-DDS PRODUCTION TOPOLOGY
                      
     +-----------------------+              +-----------------------+
     |   Service: dsh        |   HTTP OTLP  |   Service: phoenix    |
     |   (@deepseek-ai/dsh)  | -----------> |   (Arize Phoenix)     |
     |   - Port: 3080 (Web)  |   Port 6006  |   - Port: 6006 (UI)   |
     |   - Node.js 24 Cordis |              |   - Port: 4317 (gRPC) |
     |   - 4 MCP Servers     |              |   - OTel Spans & Costs|
     |   - Antigravity (agy) |              |   - ./config/phoenix  |
     +-----------------------+              +-----------------------+
                 |                                      |
                 v Host Bind Mounts                     v Persistent Storage
     +--------------------------------------------------------------+
     | HOST STORAGE & ISOLATION BOUNDARY                            |
     | - ./workspaces       -> /workspace (Isolated dev workspace)  |
     | - ./config           -> /root/.dsh (Persistent profile)      |
     | - ~/.config/antigravity -> Host Google OAuth cache (:ro)     |
     +--------------------------------------------------------------+
```

---

## 🛡️ The 10 Invariants of Agent Reliability

Every feature, pull request, and upgrade in the roadmap must adhere to these 10 core principles:

1. **Restricted Action Space**: Prefer typed MCP JSON-RPC schemas; disable raw, unconstrained bash in sandboxes.
2. **Immutable Sandboxes**: Run containers with `read_only: true`, non-root user (`10001:10001`), and `cap_drop: [ALL]`.
3. **Zero-Trust Egress**: Filter all outbound WAN traffic through an Envoy forward proxy with strict domain allowlists.
4. **In-Flight Auto-Failover**: Catch HTTP 429/503 errors and fall back across models in $<1.5\text{ s}$ without losing state.
5. **Transactional Snapshots**: Stage workspace code modifications in temporary Git worktrees; auto-rollback on test failure.
6. **Async Human Gates**: Suspend workflow execution on destructive (Tier 3) mutations until cryptographically approved.
7. **Repetitive Loop Traps**: Deterministically terminate agent execution if identical tool call hashes recur $\ge 2$ times.
8. **Cloud-Offloaded Research**: Delegate web research to Google Antigravity (`agy`); avoid memory-heavy in-container headless browsers.
9. **Outcome-Based Evals**: Evaluate task success exclusively by running sandboxed test suites; ignore model self-reports.
10. **Distributed Tracing**: Emit W3C OpenTelemetry spans capturing latency, tokens, costs, and diffs for every step.

---

## 📅 Roadmap Overview at a Glance

* **[Milestone 1 (v1.11.0)](ROADMAP.md#milestone-1-v1110--zero-trust-network-egress-model-failover--telemetry-hardening)**:
  * **`dsh`**: Envoy egress forward proxy, Cordis in-flight failover gateway, typed Antigravity search plugin, dynamic on-the-fly MCP governance.
  * **`phoenix`**: Cgroup limits (`2048M`), rolling storage retention (`14 days`), OTLP `4317/4318` standardization.
* **[Milestone 2 (v1.12.0)](ROADMAP.md#milestone-2-v1120--transactional-state-management--automated-evaluations)**:
  * **`dsh`**: Ephemeral Git worktree staging (`config/worktree-staging.mjs`), zero-diff rollback on test failure.
  * **`phoenix`**: Built-in LLM-as-a-Judge automated trajectory evaluation, token-gated OTLP authentication.
* **[Milestone 3 (v2.0.0)](ROADMAP.md#milestone-3-v200--level-40-high-assurance-sovereign-harness)**:
  * **Level 4.0 High-Assurance**: Dual-LLM Context Quarantine (IPI defense), gVisor (`runsc`) hypervisor micro-sandboxing, Parquet telemetry cold-storage export.
