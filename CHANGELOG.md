# Changelog

All notable changes to the **DeepSeek Harness (DSH-DDS)** project are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.10.0] - 2026-09-03

### Official Base Image Migration & Zero-Trust Provenance Hardening
* **Direct Official Engine & Base (`node:24-bookworm-slim` + `@deepseek-ai/dsh@0.1.2-rc.1`)**: Migrated the container build away from third-party community base image `smanx/deepseek-harness:0.1.1-rc.2`. The runtime now builds directly on official `node:24-bookworm-slim` and installs verified `@deepseek-ai/dsh@0.1.2-rc.1` directly from the official npm registry.
* **Elimination of Third-Party Reverse Proxy**: Removed `smanx`'s custom `/app/proxy` wrapper (`0.0.0.0:3080 -> 127.0.0.1:3079`). Replaced with a native declarative Cordis patch (`- id: webserver; config: { host: '0.0.0.0', port: PORT }`) in `config/profiles/web/cordis.patch.yml`, allowing the DeepSeek Harness kernel to bind directly to container interfaces with zero proxy latency.
* **Direct Signal Lifecycle in Entrypoint**: Refactored `docker/entrypoint.sh` to directly execute `node --expose-internals /usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web`, ensuring direct Unix signal propagation (SIGTERM, SIGINT) and clean teardowns without intermediate wrapper daemons.
* **Resilient Patch Resolution**: Updated `config/patch-bash-local.mjs` and the `@earendil-works/pi-ai` Gemini thought-signature bridge in `Dockerfile` to dynamically resolve candidate installation paths, ensuring resilience across hoisted and nested global npm module hierarchies.
* **Turnkey Installer Synchronization**: Updated embedded Dockerfile and configuration templates in `install_dsh.sh` to mirror the official base image architecture.

---

## [1.9.0] - 2026-09-03

### Remediation of Audit v3 Findings (ADR 0005)
* **Symlink Ancestor Canonicalization (F-02)**: Implemented `canonicalizeWithAncestorRealpath()` in `config/rbac-policy.mjs` to resolve physical realpaths of existing ancestor directories for non-existent target files, defeating symlink pivot escapes.
* **Symlink Traversal Escape Detection (F-02)**: Implemented `checkSymlinkEscape()` to detect intermediate symlinks pointing outside the allowRoot perimeter, failing closed with `RBAC_SYMLINK_ESCAPE`.
* **Fail-Closed Container Boundary (F-01, F-02)**: Removed ambient host fallback in `dsh.sh::persona workflow`. When the DSH container is offline, execution fails closed unless overridden with `--force-host-unsafe`.
* **Prior Concrete Scope Resolution (F-07)**: Resolved logical scopes (`recursive`, `workspace`) into concrete filesystem directories (`resolvePath('/workspaces')`) prior to RBAC policy validation, preventing unverified directory scanning.
* **Truthful Capability Adapters (F-04)**: Upgraded capability adapters to perform real cryptographic hashing (SHA-256 in `forensic_investigation`), real endpoint reachability probes (`verify_endpoint`), real tabular inspections (`inspect_tabular`), and persistent airgap quarantine ledgers (`contain_threat`).
* **Multi-State GRC Audit Trail (F-05)**: Recorded explicit `GRC_STEP_GATED` audit records when execution is suspended pending human approval.
* **Clean-Room Installer Bootstrapping (F-06)**: Fixed copy-else-download branching in `install_dsh.sh::fetch_or_copy_file()`. Added automated test `tests/installer_clean_room.test.mjs`.
* **Supply-Chain Pinning (F-03)**: Pinned `pnpm@10.5.2` in `Dockerfile` and `install_dsh.sh`. Pinned `action-shellcheck@2.0.0` in CI.
* **Clean CLI Lockfile (F-09)**: Normalized `config/profiles/cli/pnpm-lock.yaml` to a single clean YAML document.
* **Test Suite Expansion**: Suite expanded to **48/48 tests passing**. Published `docs/adr/0005-remediation-of-audit-v3-findings.md`.

---

## [1.8.0] - 2026-09-03

### In-Container Workflow Boundaries, Strict Directory Containment & Acyclic Policy Engine (ADR 0004)
* **In-Container Execution Boundary**: `dsh.sh::persona` now verifies if the `dsh` container is running and delegates workflow execution directly into the container (`docker compose exec -T dsh node /root/.dsh/persona.mjs "$@"`), guaranteeing that workflows execute within container Landlock, dropped capabilities, and read-only filesystem boundaries.
* **Acyclic Policy Architecture**: Extracted parsing, validation, path resolution, RBAC policy enforcement, and GRC audit logging into `config/rbac-policy.mjs`, eradicating circular coupling between `persona.mjs` and `declarative-orchestrator.mjs`.
* **Strict Directory Boundary Containment**: Replaced vulnerable `startsWith` prefix matching with `isContainedWithin()`, strictly asserting that allowlisted roots cannot authorize adjacent prefixes (e.g., `/tmp/allowed` strictly rejects `/tmp/allowed-evil`).
* **Enforced Read Allowlists**: `enforceRbacPolicy()` now verifies `filesystem.read` allowlists across all read capability adapters (`fetch_sources`, `inspect_sqlite`, `read_catalog`, `forensic_investigation`, `inspect_tabular`, `read_file`).
* **Canonical Path Resolver (`resolvePath`)**: Transparently maps Docker volume mount roots (`/workspaces` -> `./workspaces`, `/root/.dsh` -> `./config`) when operating outside Docker, terminating silent target substitution and confusing-deputy vulnerabilities.
* **Transactional ACM Workflow Suspension**: An unapproved gated step (`approval_required: true`) now halts workflow execution immediately (`status: 'SUSPENDED_APPROVAL_REQUIRED'`), preventing unapproved execution of subsequent steps.
* **Architecture Decision Record**: Published `docs/adr/0004-in-container-boundaries-and-strict-directory-containment.md`. Test suite expanded to **45/45 tests passing**.

---

## [1.7.0] - 2026-09-03

### Authoritative Declarative Orchestration & Capability Adapters (ADR 0003)
* **Authoritative Native Orchestrator**: Retired prompt serialization and Docker CLI subprocess spawning in `persona.mjs::runWorkflow()`. Replaced with direct asynchronous invocation of `DeclarativeWorkflowEngine.executeWorkflow()`.
* **Fail-Closed Capability Registry**: Registered canonical adapters for all 15 persona actions (`fetch_sources`, `inspect_sqlite`, `run_llm_query`, `write_report`, `apply_fix_or_patch`, `probe_services`, `verify_endpoint`, `read_catalog`, `parse_intent`, `fetch_sdmx_dataflows`, `validate_sdmx_schema`, `evaluate_incident`, `contain_threat`, `forensic_investigation`, `inspect_tabular`). Unhandled or fabricated actions throw `UNKNOWN_ACTION_ERROR` immediately, terminating simulated false successes.
* **Fail-Closed RBAC & Path Canonicalization**: `enforceRbacPolicy()` now enforces mandatory RBAC contracts (`RBAC_MANIFEST_MISSING`), canonicalizes file paths with `path.resolve()`, and strictly asserts write permissions against `filesystem.write` allowlists.
* **Cryptographic Parent-Child OTel Correlation**: Implemented 128-bit `traceId` and 64-bit `spanId` hierarchy linking parent workflows and child steps in streaming Arize Phoenix spans.
* **Hardened Sandbox Audit Tmpfs**: Added `/var/log/dsh:rw,nosuid,nodev,size=32m` mount in `docker-compose.sandbox.yml` to preserve auditability under `read_only: true`.
* **Comprehensive Test Suite**: Test suite expanded to **43/43 tests passing**. Published `docs/adr/0003-authoritative-declarative-orchestrator-and-capability-adapters.md`.

---

## [1.6.0] - 2026-09-03

### Out-of-Band GRC Telemetry & Deterministic E2E Sandbox (ADR 0002)
* **Out-of-Band Non-Repudiable GRC Audit Sink**: Decoupled audit logs from the mutable session filesystem (`/root/.dsh/sessions/`). Audit logs are now directed to privileged `/var/log/dsh/audit_grc.jsonl` (mode `0600`) with directory isolation (`0750`).
* **Asynchronous OpenTelemetry Span Dispatch to Arize Phoenix**: Every authorization check emits an asynchronous out-of-band OTel `ResourceSpans` payload directly to Phoenix (`/v1/traces`), guaranteeing non-repudiation and real-time security policy violation tracing.
* **Deterministic E2E Sandbox Integration Harness**: Added `tests/e2e_sandbox_confinement.test.mjs` verifying failure-closed mechanics on injected adversarial steps (`reset.sh`, `install_dsh.sh`, `/etc/shadow`, out-of-scope MCP servers) and checking kernel container boundaries. Test suite expanded to **36/36 tests passing**.
* **Architecture Decision Records**: Published `docs/adr/0002-out-of-band-grc-and-deterministic-e2e-sandbox.md`.

---

## [1.5.0] - 2026-09-03

### Governance, Risk & Compliance (GRC) & Zero Trust Architecture
* **Build-Time Immutability (ADR 0001)**: Moved all dynamic monkey-patching (`dsh-bash-local` auto-workdir creation and `pi-ai` thought-signature preservation) to Dockerfile `RUN` build steps. Cleared `docker/entrypoint.sh` of all runtime mutations, ensuring the container filesystem is 100% frozen, reproducible, and read-only.
* **Zero Trust Persona RBAC Matrix**: Declared explicit `rbac:` contracts across all 7 domain personas (`role`, `filesystem: { read, write, deny }`, `mcp: { allowed }`).
* **Transactional Authorization Proxy**: Enforced strict RBAC policy checks in `config/persona.mjs` before executing any workflow action; attempts to access denied files (`reset.sh`, `install_dsh.sh`, `/etc`) fail closed immediately.
* **Immutable GRC Audit Trail**: Added `audit_grc.jsonl` recording structured audit events (`timestamp`, `persona`, `role`, `action`, `decision: GRANTED | DENIED`, `reason`) for regulatory compliance and auditability.
* **Adaptive Case Management (ACM)**: Extended declarative workflows to support conditional branching (`when`), human-in-the-loop gates (`approval_required`), exception fallbacks (`on_failure`), and stateful tracking (`output_variable`).
* **Confinement Test Suite**: Added `tests/rbac_confinement.test.mjs`; test suite expanded to **32/32 tests passing**.

---

## [1.4.0] - 2026-09-03

### Security & Architecture (Hardening Against Execution-Payload Injection)
* **Eradication of Executable `workflow.sh` Scripts**: Completely removed all executable Bash scripts from persona packages (`config/personas/*/workflow.sh` and `templates/`). Decoupled persona instructions from execution primitives to eliminate prompt-injection weaponization (the "jailbreak rewriting its own muscles" attack vector).
* **100% Declarative Workflow Pipelines**: Upgraded all 7 domain personas (`security-auditor`, `devops-sre`, `data-analyst`, `mlops-engineer`, `sdmx-expert`, `stats-engineer`, `persona-creator`) to structured step-based declarative pipelines (`steps` with `action`, `scope`, `target`, `prompt`, `verification`).
* **Transactional Intent Interceptor (`config/persona.mjs`)**: Upgraded `runWorkflow()` into a declarative pipeline validator and transactional proxy that validates step schemas, inspects permissions, and dispatches to container runtimes with complete OpenTelemetry telemetry.
* **Security & Invariant Test Suites**:
  * Added `tests/personas.test.mjs`: Formally asserts zero executable scripts exist anywhere in persona directories and validates manifest integrity.
  * Added `tests/patches.test.mjs`: Validates `patch-pi-ai.mjs` against synthetic mock templates for clean thought signature injection, idempotency, and fail-fast drift detection.
  * Added `tests/skills.test.mjs`: Validates guidelines, roles, and instructions across all 7 domain skills.
  * Suite expanded to **26/26 automated tests passing**.

---

## [1.3.0] - 2026-09-03

### Added
* **Supply-Chain Vulnerability Scanning (I-4)**: Integrated Aquasecurity Trivy container image vulnerability scanning into CI with severity filtering and CycloneDX SBOM assertions.
* **Documentation Internal Link Guard (I-8)**: Added offline, zero-dependency Markdown internal link validation in CI covering all guides, tutorials, and schemas.
* **Model Catalog Inspection CLI (I-5)**: Added `./dsh.sh models` command allowing operators to inspect cached model counts and live sync timestamps from `models.cache.json`.
* **Phoenix Service Healthcheck & Startup Ordering (I-6)**: Provisioned Python-based urllib healthcheck on Arize Phoenix and bound `dsh` container startup to `condition: service_healthy`.
* **Build Context Exclusion (I-1)**: Added `.dockerignore` to prevent `.env`, secrets, `.git`, telemetry databases, and sessions from being uploaded to the Docker daemon.

### Changed
* **Runtime UI State Isolation (I-2)**: Migrated tracked `config/settings.yaml` to `config/settings.default.yaml` template, adding `settings.yaml` to `.gitignore` and seeding it on boot to eliminate working tree dirtiness.
* **Headless Non-Interactive TTY Guard (I-3)**: Added `-T` flag to all non-interactive `docker compose exec` calls (`run`, `headless`, `doctor`, `sync-models`, `models`) in `dsh.sh` to unblock CI, cron, and script pipelines.
* **Translation Targets Cleanup (I-7)**: Removed uninstalled `dsh-persona-memory` entries from `config/patch_translations.mjs` in favor of `dsh-mnemon`.

---

## [1.2.0] - 2026-09-02

### Added
* **AIDA Documentation Overhaul**: Reorganized `README.md` to elevate Quick Start above the fold, added audience statements, clear prerequisites, explicit verification criteria with `./dsh.sh doctor`, and next-step guides.
* **Diátaxis Documentation Index**: Grouped all 9 guide documents in `docs/` by audience (Getting Started, Daily Operations, Architecture & Reference, Theory).
* **CLI Profile Bundle Alignment**: Configured `@deepseek-ai/dsh-terminal` in `config/profiles/cli/package.json`.
* **CI Hardening**: Updated CI pipeline to Node.js 24 LTS and added `npm audit` dependency vulnerability scanning.
* **Dependabot Scope**: Added watching for `/config/profiles/cli`.
* **New Developer Documentation**: Added `CONTRIBUTING.md` documenting the 3-stage promotion lifecycle and local test workflows.

### Fixed
* **Persona YAML Validation (H-03)**: Dropped conflicting in-patch plugin array generation, resolving YAML parse errors across all 7 shipped personas.
* **Session ID Traversal Safety (L-19)**: Wired `validateSessionId` to safely permit dots in session filenames while strictly preventing directory traversal attacks (`..`).
* **Fail-Closed Phoenix Authentication (M-11)**: Replaced committed static fallback secrets with fail-closed authentication logic that requires user-supplied `PHOENIX_SECRET` when `PHOENIX_ENABLE_AUTH=true`.
* **Installer Error Propagation (M-05)**: Added strict error handling to `install_dsh.sh` so curl download failures abort installation immediately.
* **Secret Scrubber Bounds (M-08)**: Broadened regex matching for Google AI Studio keys and GitHub fine-grained PATs to minimum length bounds (`{35,}` and `{82,}`).
* **Workflow Key Lookup Exit Code (L-18)**: Ensured non-existent workflow keys exit with code 1 instead of silently exiting 0.
* **Documentation Accuracy (L-13, L-15)**: Aligned diagnostic suite count to 9 across all documentation, and clarified local cache vs OTel provider registration in model synchronization.

---

## [1.1.0] - 2026-09-02

### Added
* **Automated Audit Dossier Remediation**: Systematically resolved 22 findings across installer parity, persona distillation, container sandbox mounts, and diagnostics.
* **Pre-Configured SQLite MCP**: Registered `mcp-server-sqlite` in web profile and turnkey installer heredoc for tabular and database analysis.
* **Dynamic Parity Test Suite**: Added filesystem scanning in `tests/installer_parity.test.mjs` ensuring all canonical personas, skills, and templates are provisioned.
* **Safe Reset Ergonomics**: Separated soft reset (cache clearing, chat histories preserved) from destructive `--hard` reset.

---

## [1.0.0] - 2026-09-01

### Added
* **Initial Release**: Dual-container Docker topology pairing DeepSeek Harness with Arize Phoenix OpenTelemetry observability.
* **Native Gemini Thought Signature Bridge**: Fixed multi-turn tool-calling HTTP 400 errors with Google AI Studio.
* **Dynamic Model Synchronization**: Auto-sync for OpenRouter (420+ models) and Google Gemini (29+ models).
* **Hardened Sandbox Mode**: Read-only root filesystem, dropped capabilities, zero-egress network isolation.
