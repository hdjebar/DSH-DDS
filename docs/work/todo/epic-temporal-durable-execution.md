# 📋 Epic: Temporal Durable Agent Workflow Execution

* **Status**: To Do / Backlog
* **Target Release**: `v2.2.0`
* **Priority**: Medium
* **Category**: Reliability & Resilience

---

## 🎯 Objective

Integrate **Temporal.io** (or lightweight open-source equivalent durable execution engine) with the `DSH-DDS` microkernel to support multi-hour, multi-day resilient agent workflows that survive container crashes, network interruptions, and host reboots with exact state rehydration.

---

## 📋 Scope & Requirements

1. **Deterministic Event History**:
   * Record every persona step and capability adapter invocation as an append-only event history.
   * On container restart, replay workflow state up to the exact point of interruption without re-executing non-idempotent tool calls.

2. **Durable Human Approval Gates**:
   * Asymmetric Ed25519 approval gates (`./dsh.sh approve <id>`) should remain active indefinitely without holding in-memory Node.js timers or open sockets.

3. **Multi-Step Agent Checkpoints**:
   * Seamless integration with `config/worktree-staging.mjs` so Git worktrees persist until workflow completion or explicit cancellation.
