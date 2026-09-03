# ADR 0001: Build-Time Immutability, Zero Trust Persona RBAC, and Deterministic GRC Observability

* **Status**: Accepted
* **Date**: 2026-09-03
* **Deciders**: Core Architecture Team
* **Consulted**: Senior Security & GRC Audits

---

## 1. Context and Problem Statement

The initial architecture of DeepSeek Harness exhibited three major vulnerabilities identified during rigorous architectural audits:
1. **Runtime Patching Fragility**: `docker/entrypoint.sh` applied dynamic monkey-patches (`patch_dsh_bash_local`, `patch-pi-ai.mjs`) every time a container booted. This caused severe configuration drift, destroyed reproducibility, and meant that the state in Git diverged from the in-memory state of the container.
2. **Missing Identity Isolation & Privilege Escalation (RBAC Absence)**: AI personas shared the same filesystem permissions as the web workbench. A prompt-injected persona (e.g. `data-analyst`) could maliciously target infrastructure scripts (`reset.sh`, `install_dsh.sh`), alter other personas' skills, or access host files.
3. **Auditability Void (GRC)**: There was no immutable, cryptographically verifiable audit trail recording why an AI agent initiated an action, whether it was authorized, and how policy violations were intercepted.

---

## 2. Decision Drivers

* **Zero Trust Principle**: Never trust, always verify. Every tool call and workflow step must be authenticated and authorized against a strict Role-Based Access Control (RBAC) policy.
* **Hermetic & Immutable Builds**: Container filesystems for core modules must be immutable. All code transformations, package hoisting, and compatibility shims must execute strictly at Docker `RUN` (build time).
* **GRC Compliance**: Enterprise Governance, Risk, and Compliance demands immutable audit records for all autonomous decisions.

---

## 3. Considered Options

* **Option A**: Rely solely on Docker container boundaries (`docker-compose.sandbox.yml`).
  * *Rejected*: Containerization only protects the host, not internal application components or cross-persona data.
* **Option B**: Dynamic runtime interception in Bash wrappers (`workflow.sh`).
  * *Rejected*: Bash scripts in persona directories are vulnerable to prompt injection self-modification (the agent rewriting its own execution payload).
* **Option C (Adopted)**: **Build-Time Immutability + Declarative Persona RBAC + Transactional Interceptor in `persona.mjs` + GRC Audit Logging**.

---

## 4. Decision Outcome

### 4.1 Build-Time Immutability
* All monkey-patching (`pi-ai` thought-signature preservation and `dsh-bash-local` Landlock auto-workdir creation) is consolidated into `Dockerfile` build steps (`RUN node -e ...`).
* `docker/entrypoint.sh` is strictly prohibited from altering application JavaScript or native addons at runtime.
* The container code tree is frozen and read-only.

### 4.2 Zero Trust Persona RBAC Matrix
Every persona manifest (`persona.yaml`) declares an explicit `rbac:` contract:
```yaml
rbac:
  role: "security_auditor"
  permissions:
    filesystem:
      read: ["/workspaces", "/root/.dsh/personas/security-auditor"]
      write: ["/workspaces/cases", "/root/.dsh/sessions"]
      deny: ["/etc", "/root/.ssh", "config/personas/*", "reset.sh", "install_dsh.sh"]
    network:
      allowed_hosts: ["api.github.com", "openrouter.ai", "generativelanguage.googleapis.com"]
    mcp:
      allowed: ["github", "fetch"]
```

### 4.3 Central Transactional Proxy (`config/persona.mjs`)
* Every workflow step is intercepted prior to container dispatch.
* The engine evaluates `target`, `destination`, `scope`, and MCP tools against the persona's `rbac.permissions`.
* If a target matches `deny` or violates allowed scopes, the proxy immediately **fails closed** (throws error) and cancels execution.

### 4.4 Immutable GRC Audit Logging
* All authorization decisions (authorized or denied) are appended to `/root/.dsh/sessions/audit_grc.jsonl` and mirrored to Arize Phoenix telemetry spans with:
  * `timestamp`, `persona`, `role`, `action`, `target`, `decision: GRANTED | DENIED`, and `reason`.

---

## 5. Consequences

### Positive
* **Deterministic Reproducibility**: The container image is completely identical across dev, CI, and prod without runtime mutations.
* **Strict Least Privilege**: A compromised agent is strictly sandboxed by the transactional firewall from modifying the host or other personas.
* **Full Auditability**: Auditors can inspect every AI decision and policy enforcement in real time.

### Negative / Trade-offs
* New personas must declare an `rbac` block or inherit strict default confinement.
