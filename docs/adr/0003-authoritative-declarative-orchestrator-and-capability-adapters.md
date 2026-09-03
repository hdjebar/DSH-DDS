# ADR 0003: Authoritative Declarative Orchestrator, Typed Capability Adapters, and Correlated OTel Telemetry

* **Status**: Accepted
* **Date**: 2026-09-03
* **Deciders**: Principal Systems Architects
* **Consulted**: Senior Security & GRC Audits

---

## 1. Context and Problem Statement

Following the initial delivery of `declarative-orchestrator.mjs`, an adversarial architectural audit revealed that:
1. **Parallel Unused Implementation**: `config/declarative-orchestrator.mjs` was disconnected from the production execution path. `persona.mjs::runWorkflow()` was still serializing declarative workflow steps into natural-language prompt strings and dispatching them via `docker compose exec` subprocesses.
2. **False Success Invariant Violation**: Unhandled step actions fell through to an unhandled mock handler that reported `status: SUCCESS`. Handlers returned simulated states without executing real effects.
3. **Disconnection in RBAC & Tracing**: `parsePersonaYaml()` did not preserve `rbac` metadata in the parsed object; authorization checks did not enforce write allowlists or canonicalize file paths; and OpenTelemetry spans were disconnected without parent-child correlation.

---

## 2. Decision Drivers

* **Single Authoritative Execution Engine**: Eradicate workflow prompt serialization and subprocess invocation; make `DeclarativeWorkflowEngine` the sole authoritative orchestrator.
* **Strict Fail-Closed Mechanics**: Any missing RBAC contract or unknown action must immediately halt execution with an explicit error (`RBAC_MANIFEST_MISSING`, `UNKNOWN_ACTION_ERROR`).
* **Typed Capability Adapters**: Actions must execute verifiable filesystem, database, model, and network operations with path canonicalization against declared read/write allowlists.
* **Correlated OpenTelemetry Telemetry**: Spans must share a cryptographic 128-bit `traceId` and establish proper `parentSpanId` hierarchy between the parent workflow and child steps.
* **Sandbox Audit Invariant**: Ensure `/var/log/dsh` has a dedicated `tmpfs` mount in `docker-compose.sandbox.yml` so non-repudiable audit logging succeeds under `read_only: true`.

---

## 3. Decision Outcome

### 3.1 Authoritative Native Dispatch
* `config/persona.mjs::runWorkflow()` directly instantiates `DeclarativeWorkflowEngine` and awaits `executeWorkflow()`.
* The subprocess `docker compose exec` path is retired for workflows. The state declared in `persona.yaml` is the state natively evaluated.

### 3.2 Typed Capability Adapters (15 Core Actions)
* Handlers for all 15 persona actions are registered in the authoritative capability registry:
  * `fetch_sources`, `inspect_sqlite`, `run_llm_query`, `write_report`, `apply_fix_or_patch`, `probe_services`, `verify_endpoint`, `read_catalog`, `parse_intent`, `fetch_sdmx_dataflows`, `validate_sdmx_schema`, `evaluate_incident`, `contain_threat`, `forensic_investigation`, `inspect_tabular`.
* Any unregistered action throws `UNKNOWN_ACTION_ERROR`.

### 3.3 Path Canonicalization & Write Allowlist Enforcement
* `enforceRbacPolicy()` canonicalizes all candidate paths with `path.resolve()`.
* Steps performing write operations (`write_report`, `apply_fix_or_patch`) are checked against `permissions.filesystem.write`. Writes targeting paths outside the allowlist are denied with `RBAC_WRITE_UNAUTHORIZED`.

### 3.4 Cryptographic Parent-Child OTel Tracing
* `AgentPhoenixTracer` generates 128-bit `traceId` and 64-bit `spanId` using `node:crypto.randomBytes`.
* The workflow root span passes its `spanId` as `parentSpanId` to all child step spans.

---

## 4. Consequences

### Positive
* **Zero Subprocess Indirection**: Workflows run deterministically in JavaScript with exact context propagation.
* **Tamper-Resistant GRC**: Non-repudiable audit records and parent-child traces provide authentic execution evidence.
* **Fail-Closed Security**: Malicious or unrecognized actions cannot silently slip through.
