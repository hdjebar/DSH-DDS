# ADR 0009: Vault Master Key Fail-Closed, Identity Peer Trust, PEP Tool Mapping, and Host-Confinement Hardening

* **Status**: Accepted
* **Date**: 2026-09-07
* **Context**: Security Audit Remediation (BYOK Keystore, IAM Headers, In-Line RBAC PEP, Container Filesystem Hardening)

---

## Context & Problem Statement

A thorough audit of the DeepSeek Harness (DSH-DDS) container, compose layer, and in-line PEP revealed critical areas where the security guarantees claimed in documentation exceeded enforcement in code:

1. **Vault Master Key Default Fallback (P0)**:
   `packages/dsh-dds-core/byok-vault.js` fell back to a hardcoded string constant present in the public Git repository when `DSH_VAULT_MASTER_KEY` was unset. Deployments failing to supply the environment variable stored sensitive user API keys in effectively-plaintext.
2. **Unvalidated Identity Headers in Reverse Proxy Integration**:
   `packages/dsh-dds-core/iam.js` accepted `x-dsh-user-roles: admin` from callers without verifying whether the request arrived from a trusted reverse proxy or gateway peer, allowing tenant isolation bypass if the port were ever exposed or traversed via a proxy.
3. **PEP Tool-to-Action Namespace Divergence**:
   The authoritative RBAC policy engine in `config/rbac-policy.mjs` validated workflow DSL verbs (`write_report`, `fetch_sources`), while the in-line interceptor in `packages/dsh-dds-core/rbac-interceptor.js` intercepted raw tool names (`bash`, `write`, `edit`). Unmapped tools defaulted to an unclassified `'execute'` action, or granted fail-open admin fallback when user context was absent.
4. **Container Application Code Ownership**:
   The container ran as unprivileged user `dsh:dsh` (UID 1000), but `dsh:dsh` owned `/app`, allowing a compromised agent process in standard mode to modify its own `NODE_OPTIONS` loader or in-line policy enforcement code.
5. **Supply Chain & Resilience Peripheral Findings**:
   - `docker-compose.sandbox.yml` referenced mutable `envoyproxy/envoy:v1.31-latest` without a cryptographic digest.
   - `package.json` had a minor version divergence (`yaml@2.9.0` vs container's `yaml@2.7.0`).
   - `install_dsh.sh` silently fell back from unresolvable release refs to `main`.
   - In-memory data structures (`thoughtSignatures`) and REST request bodies had unbounded growth potential.

---

## Decision & Implementation

### 1. BYOK Vault Fail-Closed Master Secret & Payload v2
- Removed all hardcoded master secret fallbacks in `byok-vault.js`.
- The `ByokVault` constructor strictly enforces `DSH_VAULT_MASTER_KEY >= 32` characters, throwing `VAULT_MASTER_KEY_MISSING` otherwise.
- Bumped encrypted secret payloads from `version: 1` to `version: 2`; `decryptSecret` refuses insecure v1 blobs.
- Enforced a 64 KB request body cap on the HTTP REST API `/dsh-dds/api/vault/keys`.
- Automated generation of 32-byte hex secrets in `install_dsh.sh` and added `DSH_VAULT_MASTER_KEY` check to `config/doctor.mjs`.

### 2. Identity Headers Peer Trust Verification
- Extracted network trust heuristics into `packages/dsh-dds-core/net-trust.js` (`isTrustedGatewayIp`, `isLoopbackOrLocalBridgeIp`).
- `extractUserFromHeaders` requires `trustProxyHeaders === true` AND `isTrustedGatewayIp(remoteAddress)` before honoring `x-dsh-user-id` or `x-dsh-user-roles`.
- Pinned JWT bearer token verification strictly to `alg === 'HS256'`.

### 3. In-Line RBAC PEP Action Mapping & Confinement
- Defined `TOOL_ACTION_MAP` in `packages/dsh-dds-core/rbac-interceptor.js`, deterministically translating agent tools (`bash`, `execute_command`, `read_file`, `write`, `edit`, `fetch`, etc.) into policy verbs (`run_shell`, `read_file`, `create_file`, `modify_file`, `fetch_sources`, etc.).
- Added `run_shell` to `isWriteAction` in `config/rbac-policy.mjs`, ensuring shell executions are treated as writes subject to strict path allowlists.
- Removed fail-open admin principal fallback: actions without authenticated identity context fail closed immediately.
- Normalized multi-tenant workspace checks on all string targets with `path.resolve`.

### 4. Container Filesystem Ownership Hardening
- Updated `Dockerfile` to chown `/app` to `root:root` with `chmod -R 755 /app`.
- The unprivileged `dsh:dsh` process can read and execute runtime dependencies, but cannot modify `/app/packages/dsh-dds-core/` or hijack the `--import /app/packages/dsh-dds-core/loader.mjs` chain.

### 5. Supply Chain & Operational Hardening
- Pinned Envoy sidecar in `docker-compose.sandbox.yml` to immutable digest:
  `envoyproxy/envoy:v1.31-latest@sha256:caa5b411be1633b90023592a34a7e010c933d6e60206c758f631485e53006865`.
  That historical pin was superseded by digest-pinned Envoy 1.39.1 when connection-time
  `resolved_address_filter` support became required for DNS-rebinding protection.
- Aligned `package.json` to `yaml: 2.7.0`.
- Bounded `thoughtSignatures` cache in `llm-gateway.js` to 1,000 entries using FIFO eviction.
- Handled HTTP 3xx redirects up to 3 hops in `web-search.js`.
- Eliminated shell interpolation in `dsh.sh` approval check using `execFileSync` with argument arrays.
- Inverted `install_dsh.sh` ref verification: fails closed on unresolvable git tags unless `DSH_ALLOW_REF_FALLBACK=1`.

### 6. Second-Pass Audit Hardening (Fail-Closed PEP, Precedence, Shell Separation, Proxy Guards, and Sandbox TMPFS)
- **PEP Engine Fail-Closed**: If `config/persona.mjs` or `/etc/dsh/persona.mjs` cannot be resolved or is missing `enforceRbacPolicy`, the interceptor strictly throws `[Zero-Trust RBAC Violation] Policy engine unavailable` rather than returning silently.
- **`TOOL_ACTION_MAP` Precedence & Prototype Immunity**: `TOOL_ACTION_MAP` is created with a `null` prototype (`Object.assign(Object.create(null), { ... })`) to prevent prototype pollution lookups (`constructor`, `toString`). The action resolution order prioritizes explicit `toolName` before generic `action`, and validates raw actions against `KNOWN_POLICY_VERBS`.
- **Shell Command vs Path Separation**: For `run_shell` actions, `actionContext.workdir` or `actionContext.cwd` is checked against workspace path allowlists (`step.target`), while `step.command` is evaluated against `filesystem.deny` patterns, preventing commands from failing path validation or evading blacklist tokens.
- **Lazy Vault Proxy Error Guard**: `registerGatewayMiddleware` wraps vault retrieval and `handleVaultApiRequest` in `try/catch` and touches `vault.userStateBase` inside the guard, returning HTTP 500 JSON `{ success: false, error: 'VAULT_UNAVAILABLE', message: ... }` when the master key is missing.
- **Sandbox `/run` Tmpfs Confinement**: Hardened `/run` mount in `docker-compose.sandbox.yml` from world-writable `mode=1777` to non-root `mode=0770,uid=1000,gid=1000`.
- **Web Search Domain & Protocol Hardening**: In `packages/dsh-dds-core/web-search.js`, search requests strictly require `https:` protocol and `duckduckgo.com` domain for both initial requests and 3xx redirects, blocking SSRF attempts, and enforcing a 512 KB maximum body size limit.

---

## Consequences

### Positive
- **Cryptographic Assurance**: All secrets encrypted at rest in the BYOK vault use a deployment-unique, cryptographically strong master key.
- **Spoofing Defense**: Client-injected role headers are safely discarded unless originating from a verified local gateway.
- **Deterministic PEP Enforcement**: Agent tool calls are mapped to declarative policy verbs, closing the loophole where shell commands bypassed write restrictions.
- **Tamper-Proof PEP Loader**: Even in non-sandbox mode, an in-container compromise cannot overwrite the security interceptor on disk.
- **Zero Configuration Drift**: `scripts/build_installer.mjs` ensures installer heredocs match canonical sources 100%.

### Operational Impact
- Existing deployments must ensure `DSH_VAULT_MASTER_KEY` (>= 32 chars) is defined in `.env` and passed to `docker-compose.yml`.
- Any legacy v1 vault records created under the old insecure default must be re-encrypted under v2.
