# ADR 0002: Out-of-Band Non-Repudiable GRC Audit Telemetry and Deterministic E2E Sandbox Verification

* **Status**: Accepted
* **Date**: 2026-09-03
* **Deciders**: Principal Systems Architects
* **Consulted**: Senior Security & GRC Audits

---

## 1. Context and Problem Statement

Following the initial implementation of persona RBAC in ADR 0001, a secondary adversarial architecture review identified two lingering GRC vulnerabilities and an observability deficit:
1. **Co-located Audit Ledger (Repudiation Risk)**: The GRC audit log (`audit_grc.jsonl`) was written directly inside `/root/.dsh/sessions/`. Because agents require write access to `/root/.dsh/sessions` for conversational state persistence, an untrusted or compromised agent process possessed the technical capability to truncate, poison, or forge entries in its own compliance log.
2. **Cooperative vs. Kernel Enforced Isolation**: Application-level authorization in Node.js middleware must be backed by isolated container mounts and filesystem boundaries to prevent bypass via child processes.
3. **Observability & Testing Disparity**: Testing isolated regex rules and in-memory mock objects provided superficial confidence without validating deterministic contract execution inside the hardened container sandbox.

---

## 2. Decision Drivers

* **Non-Repudiation (SOC 2 / ISO 27001)**: An audited agent must never have write access to its own audit ledger.
* **Out-of-Band Telemetry**: Audit events must be dispatched via independent network channels directly to the observability sink (Arize Phoenix).
* **Deterministic Contract Assertions**: CI must mathematically verify that declared JSON schemas, RBAC constraints, and Landlock workdir boundaries hold without relying on flaky, stochastic prose assertions from external cloud LLMs.

---

## 3. Considered Options

* **Option A**: Write audit events exclusively to host stdout/stderr logs.
  * *Rejected*: Mixed stdout/stderr streams in container orchestrators are susceptible to log-stripping and unstructured interleaving.
* **Option B**: Run live frontier LLM queries during every CI pull-request check.
  * *Rejected*: Introduces stochastic test failures, non-determinism, external API token costs, and network flakiness.
* **Option C (Adopted)**: **Dedicated Privileged Audit Sink (`/var/log/dsh/`) + Out-of-Band OTel Span Dispatch to Phoenix + Deterministic E2E Sandbox Contract Harness**.

---

## 4. Decision Outcome

### 4.1 Out-of-Band Privileged Audit Sink
* Audit records are written to `/var/log/dsh/audit_grc.jsonl`, which is isolated from the agent's mutable `/root/.dsh/sessions/` directory.
* The audit log file is initialized with strict mode `0600` (read/write only by root/dsh daemon) and directory mode `0750`.
* In `docker-compose.sandbox.yml`, `/var/log/dsh` is mounted into a dedicated volume or restricted tmpfs.

### 4.2 Out-of-Band OpenTelemetry Span Dispatch
* Every authorization decision (`GRANTED` or `DENIED`) generates a structured OpenTelemetry v1 `ResourceSpans` payload.
* The telemetry event is dispatched asynchronously via HTTP POST directly to the Arize Phoenix collector (`/v1/traces`).
* Even if an attacker attempts disk tampering, the out-of-band Phoenix span provides an immutable, external record of the decision.

### 4.3 Deterministic E2E Sandbox Integration Test
* Implemented in `tests/e2e_sandbox_confinement.test.mjs`.
* Formally evaluates multi-step declarative pipelines under sandbox parameters, validating:
  * Proper execution of allowed domain actions.
  * Immediate fail-closed blocking of injected adversarial steps (`reset.sh`, `install_dsh.sh`, `/etc/shadow`, unauthorized MCP servers).
  * Presence of non-repudiable GRC audit events and valid OTel trace structures.

---

## 5. Consequences

### Positive
* **Full Non-Repudiation**: The audit log is separated from the agent's conversational session store.
* **Zero-Trust Telemetry**: Phoenix records security policy violations in real time.
* **Reliable CI**: 100% deterministic testing without external API calls or flakiness.
