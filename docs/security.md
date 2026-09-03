# 🔒 Security Architecture & Security Audit

DeepSeek Harness within this Docker stack is designed with multi-layered defensive security controls to protect host files, sensitive credentials, and telemetry traces.

This document serves as both the **Security Architecture Guide** and the **Security Audit Reference**, tracking threat models, known risks, and hardening guidelines.

---

## 🛡️ Executive Summary & Security Posture

* **Overall Posture**: **GOOD** for local, single-developer environments; **REQUIRES SANDBOX OVERRIDE** when evaluating untrusted code or running multi-tenant hosts.
* **Network Isolation**: All exposed endpoints (`3080` for DSH Web UI, `6006` for Arize Phoenix) bind strictly to loopback (`127.0.0.1`), preventing external LAN/WAN network exposure.
* **Supply Chain Security**: Base images are pinned to immutable cryptographic digests (SHA256), eliminating image-tag mutability risks.
* **Data Sovereignty**: Observability (Arize Phoenix) runs 100% on-premise; no prompt traces or completion tokens egress to third-party cloud vendors.

---

## 📊 Vulnerability & Risk Matrix (Security Audit)

| ID | Category | Severity | Finding | Status / Remediation |
| :--- | :--- | :---: | :--- | :--- |
| **SEC-01** | **Access Control** | **HIGH** | Unauthenticated Web UI & Telemetry Endpoints | Mitigated on host network via loopback (`127.0.0.1`). Use reverse proxy with auth for remote access. |
| **SEC-02** | **Container Isolation** | **HIGH** | Default Container Runs as Root with Read-Write Host Mounts | Remediated via `docker-compose.sandbox.yml` (`cap_drop: ALL`, `:ro` mounts, `no-new-privileges`). |
| **SEC-03** | **Credential Security** | **MEDIUM** | API Keys Injected via Process Environment | Stored in memory / `/proc/1/environ`. Recommend restricted-scope keys and system prompt constraints. |
| **SEC-04** | **Least Privilege** | **MEDIUM** | GitHub MCP Server Blast Radius | Restrict GitHub Personal Access Tokens to fine-grained repository scopes. |
| **SEC-05** | **Data Privacy** | **LOW** | Full Prompt & Response Tracing in Phoenix Telemetry | 100% on-premise storage. Switch to `DSH_TELEMETRY_MODE=METRICS_ONLY` for sensitive datasets. |
| **SEC-06** | **Supply Chain** | **PASS** | Immutable SHA256 Image Digests & Safe Parser | Pinned base digests and regex-enforced `.env` variable loader prevent injection. |
| **SEC-07** | **Zero Trust RBAC** | **PASS** | Cross-Persona Escalation & Host Script Execution | Remediated via declarative `rbac:` contracts and transactional proxy blocking `reset.sh`/`install_dsh.sh` ([ADR 0001](adr/0001-build-time-immutability-and-rbac.md)). |
| **SEC-08** | **Immutability** | **PASS** | Runtime Monkey-Patching Configuration Drift | Remediated via build-time Docker patching; zero runtime mutation in `entrypoint.sh` ([ADR 0001](adr/0001-build-time-immutability-and-rbac.md)). |
| **SEC-09** | **Filesystem Boundaries** | **PASS** | Symlink Traversal Pivots & Directory Escape | Remediated via `canonicalizeWithAncestorRealpath()` and `checkSymlinkEscape()` in `config/rbac-policy.mjs` ([ADR 0004](adr/0004-in-container-boundaries-and-strict-directory-containment.md), [ADR 0005](adr/0005-remediation-of-audit-v3-findings.md)). |
| **SEC-10** | **Execution Boundary** | **PASS** | Ambient Host Execution Fallback in CLI | Remediated via fail-closed in-container execution dispatch in `dsh.sh` ([ADR 0004](adr/0004-in-container-boundaries-and-strict-directory-containment.md), [ADR 0005](adr/0005-remediation-of-audit-v3-findings.md)). |

---

## 🔍 Detailed Audit Findings

### 1. [SEC-01] Access Control & Localhost Endpoints
* **Threat Model**:
  - DSH Web Workbench (`http://localhost:3080`) and Arize Phoenix (`http://localhost:6006`) do not implement authentication out of the box.
  - While ports are strictly bound to `127.0.0.1`, any local process, local user, or malicious browser tab executing Cross-Origin/DNS-rebinding attacks on the host could interact with the agent or inspect telemetry.
* **Hardening Guideline**:
  - Never bind `DSH_PORT` or `PHOENIX_PORT` to `0.0.0.0` on public machines.
  - If exposing the service across a LAN, VPN, or Tailscale network, enforce authentication via an upstream reverse proxy (Nginx, Caddy, or Cloudflare Access).

### 2. [SEC-02] Process Privileges & Host Configuration Mount
* **Threat Model**:
  - Under standard `docker-compose.yml`, the container runs as `root` (UID 0) and mounts `./config` as read-write (`./config:/root/.dsh`).
  - If an untrusted agent prompt or rogue MCP tool executes arbitrary commands, host configuration files (`sync_models.mjs`, `doctor.mjs`, `cordis.patch.yml`) could be modified.
* **Hardening Guideline**:
  - **Always launch with the sandbox override when analyzing unverified repositories:**
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
    ```
  - In sandbox mode, `./config` is mounted read-only (`:ro`), root filesystem is read-only (`read_only: true`), all Linux capabilities are dropped (`cap_drop: [ALL]`), and runtime configuration is held in temporary memory (`tmpfs`).

### 3. [SEC-03] Credential Security in Container Environment
* **Threat Model**:
  - Sensitive frontier keys (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`) are injected into the container as environment variables.
  - Any shell tool or subprocess executed within the container can read `/proc/1/environ` or run `printenv`.
* **Hardening Guideline**:
  - The turnkey installer enforces `chmod 0600 $DSH_INSTALL/.env` to prevent unauthorized local file reads.
  - Avoid sharing execution logs or terminal sessions that output environment variables.
  - Configure spending quotas and rate limits on provider dashboards (OpenRouter FinOps / Google AI Studio).

### 4. [SEC-04] GitHub MCP Server Least Privilege
* **Threat Model**:
  - The official `github-mcp-server` has capabilities to create branches, push code, and update issues and PRs.
  - Supplying a classic GitHub PAT with full `repo` or `admin:org` scope grants the agent excessive write access across all your personal and organization repositories.
* **Hardening Guideline**:
  - Generate a **Fine-Grained Personal Access Token (Beta)** restricted to **Only select repositories**.
  - Grant only *Contents: Read and write* and *Pull requests: Read and write*. Deny repository administration, workflow management, and delete rights.

### 5. [SEC-05] Observability & Telemetry Retention
* **Threat Model**:
  - `DSH_TELEMETRY_MODE=FULL` streams entire multi-turn conversation transcripts, system prompts, tool call parameters, and model reasoning blocks into Arize Phoenix (`./config/phoenix`).
  - If processing confidential files or proprietary datasets, these artifacts persist in local SQLite/parquet databases.
* **Hardening Guideline**:
  - If processing sensitive or non-redactable code, configure in `.env`:
    ```env
    DSH_TELEMETRY_MODE=METRICS_ONLY
    ```
  - Periodically prune or wipe telemetry data:
    ```bash
    rm -rf config/phoenix/*
    ```

### 6. [SEC-07] Zero Trust Identity Isolation & Persona RBAC
* **Threat Model**:
  - Containerization isolates the Docker host from the container, but does not isolate personas from each other.
  - A prompt-injected or compromised persona (e.g. `data-analyst` handling untrusted CSV/SQL) could attempt to read credentials, mutate skills of `security-auditor`, or trigger administrative scripts (`reset.sh`, `install_dsh.sh`).
* **Hardening Guideline & Enforcement**:
  - Every persona manifest (`persona.yaml`) declares a strict `rbac:` policy specifying allowed roles, readable/writable filesystem paths, allowed MCP tools, and explicit `deny` paths.
  - The authoritative policy engine in `config/rbac-policy.mjs` (`enforceRbacPolicy()`) intercepts every workflow step prior to execution, performs directory containment checks (`isContainedWithin`), checks for escaping symlinks (`checkSymlinkEscape`), and fails closed if a target matches a deny pattern or exceeds authorization.
  - See [ADR 0001](adr/0001-build-time-immutability-and-rbac.md), [ADR 0004](adr/0004-in-container-boundaries-and-strict-directory-containment.md), and [ADR 0005](adr/0005-remediation-of-audit-v3-findings.md).

### 7. [SEC-08] Build-Time Immutability vs. Runtime Monkey-Patching
* **Threat Model**:
  - Dynamically applying code patches in `docker/entrypoint.sh` at container startup introduces non-reproducibility, drift, and divergence between Git state and in-memory application state.
* **Hardening Guideline & Enforcement**:
  - All compatibility shims (`pi-ai` thought-signature preservation and `dsh-bash-local` Landlock auto-workdir creation) are compiled directly into the Docker image layers at build time (`RUN`).
  - `docker/entrypoint.sh` is strictly read-only regarding application code; zero dynamic string mutations or regex patchers execute at container boot.

### 8. [GRC-01] Immutable GRC Audit Trail (`audit_grc.jsonl`)
* **Governance Standard**:
  - Enterprise compliance frameworks (EU AI Act, SOC 2, ISO 27001) require verifiable audit trails of autonomous agent decisions.
  - Every authorization check is appended as a structured JSON Lines record to `/root/.dsh/sessions/audit_grc.jsonl`:
    ```json
    {
      "timestamp": "2026-09-03T01:32:22.185Z",
      "event_type": "GRC_AUTHORIZATION_DECISION",
      "persona": "data-analyst",
      "workflow": "analyze_pipeline",
      "step_index": 1,
      "step_name": "Profile Relational Datasets",
      "action": "inspect_sqlite",
      "target": "/workspaces/data.db",
      "decision": "GRANTED",
      "role": "data_analyst",
      "reason": "Policy validated"
    }
    ```

---

## 🛡️ Hardened Sandbox Mode (`docker-compose.sandbox.yml`)

When using DSH to analyze external or unverified code repositories, start with the sandbox override:

```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

### Sandbox Protections Matrix

| Control | Standard Mode (`docker-compose.yml`) | Sandbox Mode (`sandbox.yml`) |
| :--- | :--- | :--- |
| **Root Filesystem** | Writable | **Read-Only (`read_only: true`)** |
| **Linux Capabilities** | Default Docker capabilities | **All Dropped (`cap_drop: ALL`)** |
| **Privilege Escalation** | Allowed | **Blocked (`no-new-privileges: true`)** |
| **Host Config Mount** | Read-Write (`./config:/root/.dsh`) | **Read-Only (`./config:/opt/dsh-config:ro`)** |
| **Workspace Mount** | Read-Write (`./workspaces`) | **Read-Only (`./workspaces:ro`)** |
| **Container Networking** | Bridge (Internet egress active) | **Zero-Egress Internal (`internal: true`)** |
| **Resource Constraints** | Unlimited | **Strict Limits (2 CPUs, 2GB RAM, 150 PIDs)** |
| **Configuration State** | Persisted on host | **Disposable `tmpfs` (reset on boot)** |

To destroy all transient sandbox session data:
```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml down -v
```

---

## ⚠️ Mandatory Plugin & Supply Chain Auditing Policy

Plugins and MCP tool servers in DeepSeek Harness execute directly within the Node.js container runtime with full access to mounted workspaces, environment variables, and system tools.

### Why Every Added Plugin Must Be Audited
* **In-Process Runtime Execution**: DSH plugins load as dynamic Node.js/Cordis modules. An unvetted or malicious plugin executes with the same privileges as the agent itself.
* **Credential Protection**: Although environment variables are protected from external network traffic, any in-process plugin can access `process.env` (including `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, and `GITHUB_PERSONAL_ACCESS_TOKEN`).
* **Supply Chain Attack Vectors**: Third-party npm packages can introduce compromised lifecycle scripts (`preinstall`, `postinstall`), unvetted transitive dependencies, or covert data-exfiltration logic.

### Pre-Installation Audit Checklist
Before adding any community plugin to `config/profiles/web/package.json` or installing via `dshmarket`:
1. **Source Code Inspection**: Review the plugin's source repository for obfuscated code, arbitrary `eval()`, or unexpected HTTP/WebSocket outbound connections.
2. **Lifecycle Scripts Verification**: Ensure the package's `package.json` does not declare suspicious `preinstall`, `install`, or `postinstall` hooks.
3. **Lockfile & Version Pinning**: Always pin strict versions in `package.json` and verify that dependencies resolve deterministically via `pnpm-lock.yaml`.
4. **Static Sandbox Policy**: When evaluating untrusted external code, never install new or unverified plugins dynamically; keep the plugin set minimal, fixed, and fully vetted.

---

## 📋 Security Best Practices Checklist

- [x] Ensure `.env` is never committed to Git (verified in `.gitignore`).
- [x] Keep `.env` permissions set to `0600` (`chmod 0600 .env`).
- [x] Use fine-grained GitHub PATs scoped strictly to individual repositories.
- [x] Enforce `docker-compose.sandbox.yml` when handling untrusted code or external inputs.
- [x] Thoroughly audit all third-party plugins and MCP servers before adding them to the environment.
- [x] Set spending caps on API provider accounts to prevent FinOps anomalies.
- [x] Run `./dsh.sh doctor` to regularly audit credentials, permissions, and network bindings.
