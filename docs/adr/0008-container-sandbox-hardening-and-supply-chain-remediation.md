# ADR 0008: Container Sandbox Hardening, Supply Chain Integrity, and Credential Isolation

> **Historical decision record:** The direct audit-mount design described below has been superseded by the external `audit-writer` boundary documented in [`docs/architecture/security-model.md`](../architecture/security-model.md). Retain this ADR as remediation history; do not use its direct-mount instructions for new deployments.

* **Status**: Accepted & Implemented
* **Date**: 2026-09-07
* **Deciders**: DeepSeek Harness Architecture & Security Team (`DSH-DDS`)
* **Consulted**: DevSecOps, Application Security, Platform Engineering
* **Informed**: All Core Maintainers, Persona Developers, and System Operators

---

## 1. Context and Problem Statement

Following the foundational non-root and Linux FHS refactoring in [ADR 0006](0006-global-refactoring-non-root-fhs-cordis-plugin.md) and credential-isolated web search architecture in [ADR 0007](0007-rejection-of-in-container-antigravity-and-credential-isolation.md), an external adversarial security audit identified operational and architectural vulnerabilities across the container runtime, Docker Compose topology, and supply chain layer:

1. **P0: Provider Credential Inheritance in Sandbox Mode**:
   `docker-compose.sandbox.yml` did not explicitly clear or mask host environment variables (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `TAVILY_API_KEY`). Consequently, containers launched in sandbox mode inherited host frontier keys, exposing them to untrusted workflows evaluated inside the sandbox.
2. **P0: GRC Audit Log Destruction in Sandbox Mode**:
   Sandbox mode mounted a disposable `tmpfs` over `/var/lib/dsh`, resulting in the silent destruction of the immutable GRC audit ledger (`audit_grc.jsonl`) upon container shutdown or reset (`docker compose down -v`). This violated the non-repudiation invariant established in [ADR 0002](0002-out-of-band-grc-and-deterministic-e2e-sandbox.md).
3. **P1: Production Image Immutability Violation via Dev Mounts**:
   `docker-compose.yml` declared host bind mounts for `./packages/dsh-dds-core` and `./docker/entrypoint.sh`. While convenient for live development, mounting mutable host files into production containers defeated image immutability and risked container configuration drift.
4. **P1: Missing Resource Caps in Standard Production Compose**:
   Standard mode lacked cgroup CPU, memory, and process limits (`pids_limit`), leaving the Docker host susceptible to Denial-of-Service (DoS) or Out-Of-Memory (OOM) lockups from runaway agent loops.
5. **P2: Residual Compiler Toolchains in Production Runner Stage**:
   The final runtime image retained build compilers (`make`, `g++`) installed during native package compilation, needlessly expanding the attack surface for Living-off-the-Land (LotL) binary compilation.
6. **P2: Non-Deterministic Dependency Resolution**:
   Package installation in `Dockerfile` omitted `--frozen-lockfile`, permitting non-deterministic dependency drift during container builds.
7. **P2: Ambiguity in Threat Model Boundaries**:
   Documentation previously implied that the Node.js loader (`loader.mjs` / `NODE_OPTIONS`) served as a hard sandbox containment boundary, rather than an application-level Policy Enforcement Point (PEP) and runtime compatibility shim.

---

## 2. Decision Drivers

* **Fail-Closed Sandbox Credential Isolation**: Under no circumstances may untrusted code running inside a sandbox container access host frontier API keys or identity tokens.
* **Non-Repudiation Invariant (SOC 2 / ISO 27001)**: GRC compliance audit logs must persist across container restarts and sandbox teardowns.
* **Separation of Production vs. Development Topologies**: Production compose files must rely strictly on immutable container images; developer live mounts must be isolated to an explicit dev override.
* **Host Resource Protection**: Prevent Denial of Service by enforcing kernel cgroup limits across all compose modes.
* **Minimal Attack Surface**: Purge compilers and development utilities from production runner images.
* **Supply Chain Determinism**: Pin dependencies strictly via `--frozen-lockfile` and synchronized lockfiles.
* **Accurate Threat Model Demarcation**: Explicitly document the division of responsibility between application-level PEPs and kernel-level process containment.

---

## 3. Decision Outcome

We adopted and implemented the following remediations across the architecture:

### 3.1 Pillar 1: Explicit Sandbox Credential Overrides
In `docker-compose.sandbox.yml`, all provider credential variables are explicitly overridden with empty/dummy values:
```yaml
environment:
  - OPENROUTER_API_KEY=
  - GEMINI_API_KEY=
  - TAVILY_API_KEY=
  - FIRECRAWL_API_KEY=
  - EXA_API_KEY=
  - GITHUB_PERSONAL_ACCESS_TOKEN=
  - GITHUB_TOKEN=
  - PHOENIX_API_KEY=
  - PHOENIX_SECRET=
```
Untrusted code executing inside the sandbox cannot read or exfiltrate host credentials from `/proc/1/environ` or process memory.

### 3.2 Pillar 2: Persistent Host GRC Audit Sink & Dedicated Named Session Volume
To reconcile non-repudiable audit retention with disposable session isolation:
1. **Persistent Audit Mount**: `./config/audit:/var/lib/dsh/audit:rw` is mounted into the sandbox container. All GRC authorization decisions (`audit_grc.jsonl`) write directly to the host audit repository with mode `0600` / `0750`.
2. **Dedicated Named Volume (`sandbox-session-state`)**: Untrusted session transcripts and temporary state write to `sandbox-session-state:/var/lib/dsh-state:rw`, completely separated from trusted `./config/sessions`. Transient sandbox state is safely destroyed via `docker compose down -v` without deleting the GRC audit history.

### 3.3 Pillar 3: Developer Live Mount Isolation (`docker-compose.dev.yml`)
All host bind mounts for `@dsh-dds/core` and `entrypoint.sh` were removed from `docker-compose.yml` and isolated in `docker-compose.dev.yml`:
```bash
# Production mode (Immutable image):
docker compose up -d

# Development mode (Live-reload code mounts):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### 3.4 Pillar 4: Container Resource Caps & Limits
Enforced cgroup limits in `docker-compose.yml`:
```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'
      memory: 4096M
    reservations:
      cpus: '0.5'
      memory: 512M
```
Sandbox mode (`docker-compose.sandbox.yml`) enforces tighter constraints: `2.0 CPUs`, `2048M RAM`, and `pids: 150`.

### 3.5 Pillar 5: Compiler Purging & Supply Chain Freezing
1. **Runner Stage Compiler Stripping**: `Dockerfile` installs `build-essential`, `python3`, `make`, `g++` strictly in the build stage, prebuilds all packages, and purges compilers (`apt-get purge -y make g++`) before container finalization.
2. **Frozen Lockfile Enforcement**: `pnpm install --prod --frozen-lockfile` is strictly enforced.
3. **Lockfile Synchronization**: Root and web profile lockfiles (`config/profiles/web/pnpm-lock.yaml`) are kept in strict synchronization.

### 3.6 Pillar 6: Dual-Network Envoy Egress Proxy Sidecar
Egress filtering is enforced via an independent Envoy proxy sidecar (`egress-filter` running `envoyproxy/envoy:v1.31-latest`):
* `dsh` and `phoenix` reside on `dsh-internal` (`internal: true`), possessing no default route to the external internet.
* `egress-filter` bridges `dsh-internal` and `dsh-egress-net`.
* All outbound traffic from `dsh` transits `HTTP_PROXY=http://egress-filter:10000`.
* Outbound traffic is restricted to Tier 1 allowlisted model gateways (`openrouter.ai`, `generativelanguage.googleapis.com`) and package registries, with Tier 2 public fetch restricted to read-only `GET`/`HEAD` with strict 10-second timeouts.

### 3.7 Pillar 7: Threat Model Boundary Demarcation
We formally document that:
* **`loader.mjs` / `NODE_OPTIONS`** is an in-process application compatibility layer and Policy Enforcement Point (PEP) for Node.js modules. It is not an uncircumventable sandbox against native binary escape.
* **Process-Level Containment** is enforced by the Linux kernel: unprivileged UID 1000 execution, capability stripping (`cap_drop: ALL`), disabled privilege escalation (`no-new-privileges`), read-only root filesystems, Landlock LSM, and network namespaces.

---

## 4. Consequences & Verification

### Positive Consequences
* **Immunity to Credential Exfiltration**: Sandbox mode is cryptographically and contextually severed from host credentials.
* **Audit Non-Repudiation**: GRC logs survive all sandbox teardowns and container resets.
* **Zero Development Drift in Production**: Production deployments execute purely from verified image artifacts.
* **Host Resiliency**: Resource limits prevent container runaway denial of service.
* **Reduced Attack Surface**: Production images contain zero C++ compilers.

### Verification Evidence
* **Automated Topology Tests**: Added `tests/compose_topology.test.mjs` (14 assertions) verifying credential masking, volume isolation, dev mount separation, and resource limits.
* **Deterministic Contract Pass**: Full test suite (`npm test`) passes 156/156 checks across all test suites.
* **Continuous Integration**: GitHub Actions workflow passes 100% green (`Security Scans` and `Container Build & Offline MCP Smoke Tests`).
