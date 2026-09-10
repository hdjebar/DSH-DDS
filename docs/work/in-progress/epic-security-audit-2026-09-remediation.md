# 📋 Epic: September 2026 Security Audit Remediation
* **Status**: In Progress / Security Remediation
* **Priority**: Critical
* **Category**: Security, Multi-Tenancy & Runtime Isolation
* **Source Audit**: [`../done/security-audit-2026-09.md`](../done/security-audit-2026-09.md)

---

## Objective

Remediate the findings reproduced during the September 2026 review of the current
repository. The new review supersedes any older disposition in the source audit where a
finding marked fixed or accepted can still be reproduced against the current code.

The target security property is that an authenticated workload can access only its own
authorized resources, even when it can submit arbitrary shell syntax, concurrent requests,
or attacker-controlled URLs.

## Confirmed findings

| Priority | Finding | Required outcome |
| :---: | :--- | :--- |
| Critical | Shell authorization validates the declared work directory, not the command's real effects. | OS-level execution isolation prevents access to other users, secrets, audit state, and application state. |
| High | Request authorization can fall back to mutable global identity state. | Every protected invocation uses an immutable, request-scoped authenticated principal. |
| High | Lossy user-ID normalization permits distinct identities to share a partition. | Partitions use a versioned, collision-resistant identifier derived from issuer and subject. |
| High | The application and workloads can write the audit store used to establish accountability. | A separately trusted writer owns append-only, tamper-evident audit storage. |
| Medium | Declarative network tools accept arbitrary URLs and can consume unbounded responses. | Central egress validation blocks SSRF and enforces redirect, timeout, and size limits. |
| Medium | The restart route accepts a remote same-origin request because its trust checks are combined incorrectly. | Restart requires local transport and administrator authorization, or is removed from HTTP. |
| Medium | Installer secret generation can fall back to predictable timestamp-derived material. | Secret generation uses a cryptographic RNG and fails closed when none is available. |
| Low | The PEP creates a work directory before identity and authorization succeed. | Denied and malformed requests cause no filesystem mutation. |

## Implementation status — 10 September 2026

Implemented and regression-tested in the current worktree:

* shell execution defaults closed in the PEP and declarative policy, with a clearly scoped
  trusted single-operator escape hatch that sandbox mode ignores;
* shell child environments use an allowlist and denied requests do not create workdirs;
* authenticated identity uses immutable asynchronous request context and no longer trusts
  mutable `ctx.user` state;
* issuer-bound, case-sensitive `u2` partition identifiers replace lossy normalization;
* legacy vault access requires an explicit injective mapping and writes copy forward to the
  new partition while preserving rollback data;
* declarative outbound tools enforce host/protocol/port allowlists, private-address checks,
  redirect revalidation, timeouts, and bounded SDMX bodies;
* restart requires local transport, same origin, administrator role, and a CSRF token;
* installer secrets use only cryptographic randomness and include restart, audit-writer,
  executor, and Phoenix authentication material;
* the external audit-writer exclusively owns the HMAC ledger and checkpoint mounts, requires
  authenticated receipts for grants, rejects unanchored legacy records, and recovers a single
  verified ledger-ahead crash state;
* shell calls run through a networkless UID 11000 executor with short-lived capabilities,
  full-enforcement Landlock, resource limits, and per-invocation user/PID namespaces via
  `unshare` (with conservative serialization); and
* tenant migration tooling inventories, fingerprints, backs up, applies, verifies, and retries
  reversible partition migrations with runtime UUID and path-containment checks.

Still required before this epic can move to Done:

* bind validated DNS results to the actual outbound connection, or force all such traffic
  through an egress component that pins and rejects private destinations, to close DNS
  time-of-check/time-of-use rebinding. Sandbox traffic is forced through Envoy, but its dynamic
  resolver is not yet private-address pinned;
* provision and activate a scoped Phoenix ingestion key, then remove the bootstrap administrator
  credential from routine service configuration;
* publish audit checkpoints to remote or WORM storage if coordinated host compromise is in scope;
* execute the migration workflow against representative real tenant data; and
* run the new controls in live standard and sandbox containers when a Docker daemon is
  available, including namespace, Landlock, audit-tamper, telemetry-auth, timeout, output-bomb,
  cancellation, and rollback probes.

Current automated verification: **213/213 tests pass**. Installer parity, JavaScript/shell syntax,
schema parsing, whitespace checks, both Compose configurations, root and production-web dependency
audits, and CI workflow parsing pass. GitNexus classifies the combined change set as **Critical**:
191 changed symbols affect 29 execution flows. This requires staged review and rollout.

## Change-risk warning

GitNexus impact analysis marks these areas as unsafe to change in a single undifferentiated
patch:

* `enforceRbacPolicy` — **Critical** blast radius across normal workflow execution,
  fallbacks, resumptions, and agent workflows.
* `sanitizeUserId` — **Critical** blast radius across IAM, BYOK vaults, workspaces,
  sessions, and path authorization.
* `DeclarativeWorkflowEngine` — **High** blast radius across primary and resumed workflow
  execution.

Run `gitnexus impact <symbol> --direction upstream` immediately before changing each
symbol. Warn reviewers again for High or Critical results. Run `gitnexus detect-changes`
before every commit.

## Delivery plan

### 1. Emergency containment

1. Disable unrestricted shell execution for non-administrator and untrusted users by
   default.
2. Give command processes an explicit environment allowlist; do not inherit application
   secrets.
3. Remove other users' partitions, audit storage, BYOK vaults, and shared application state
   from the shell execution mount namespace.
4. Add adversarial regression tests for cross-user reads, environment extraction, and audit
   modification.

This containment must ship before the platform is represented as safe for multi-user or
untrusted shell execution.

### 2. Request-scoped identity

1. Require an explicit authenticated principal on every protected tool invocation.
2. Remove authorization fallback to `IamService.currentUser` and other process-global
   mutable identity.
3. Bind the principal to immutable request or session context, using `AsyncLocalStorage`
   where implicit propagation is unavoidable.
4. Reject absent, conflicting, expired, or untrusted identity.
5. Add synchronized Alice/Bob concurrency tests that would expose cross-request identity
   overwrite.

### 3. Collision-resistant identity migration

Replace lossy character substitution with a stable opaque partition identifier:

```text
issuer + subject -> SHA-256 -> encoded, versioned user partition ID
```

The migration must:

1. Inventory existing workspaces, vaults, sessions, storage metadata, and ownership data.
2. Detect existing normalization collisions before moving anything.
3. Produce a reversible migration manifest and backup.
4. Support old-path reads temporarily while writing only the new format.
5. Validate ownership and contents before removing compatibility reads.

Never migrate colliding records automatically without an explicit conflict resolution.

### 4. Isolated command executor

Move shell execution behind a dedicated executor with:

* a separate sandbox per invocation or tenant;
* a dedicated unprivileged UID;
* read-only application and policy code;
* only the caller's workspace mounted writable;
* no audit, vault, Docker socket, shared state, or other-user mounts;
* CPU, memory, process-count, timeout, and output-size limits;
* an environment allowlist and controlled network egress; and
* structured capabilities issued by the PEP.

Command-text inspection may remain a detection tripwire, but it must not be treated as the
tenant isolation boundary. Standard mode must use the same executor or be explicitly
documented and gated as trusted single-operator mode.

### 5. Trusted audit boundary

1. Add a separate audit-writer service reached through a narrow Unix socket or mutually
   authenticated endpoint.
2. Remove writable audit mounts from the application and command executors.
3. Validate the event schema and add monotonic sequence data, hash chaining or HMAC, and
   signed checkpoints.
4. Preserve fail-closed recording for grants while keeping the original result for denial,
   gating, and recovery paths.
5. Restrict Phoenix to telemetry ingestion, require authentication, and block workload
   access to administrative and GraphQL interfaces.

### 6. SSRF-safe outbound access

Create one outbound-request security component shared by all declarative network tools:

1. Require HTTPS where supported and restrict destinations to configured services or
   approved SDMX hosts.
2. Resolve DNS and reject loopback, private, link-local, multicast, and metadata addresses
   for IPv4 and IPv6.
3. Revalidate every redirect and restrict destination ports.
4. Enforce connection/read timeouts and maximum response sizes while streaming.
5. Force traffic through the controlled egress path so a caller cannot bypass validation.
6. Limit service probes to a configured internal service registry.

### 7. Restart and lifecycle controls

Prefer replacing the HTTP restart route with a host-only CLI or protected Unix socket. If
HTTP remains, require all of: loopback transport, valid same-origin verification,
authenticated administrator role, CSRF token, POST, rate limiting, and an audit event.
Each trust check must reject independently.

### 8. Remaining hardening

1. Move work-directory creation after identity validation and authorization.
2. Replace the installer timestamp fallback with a cryptographic Node.js fallback and fail
   closed if secure randomness is unavailable.
3. Enforce the expected encrypted-vault version and schema.
4. Correct documentation that overstates shell isolation, audit immutability, or telemetry
   guarantees.

## Pull-request sequence

Keep the security boundaries reviewable and independently reversible:

1. **Emergency containment** — shell restrictions, restart fix, and authorization-before-
   mutation tests.
2. **Identity isolation** — request-scoped principal and concurrency tests.
3. **Identity migration** — versioned partition IDs, collision inventory, migration, and
   rollback.
4. **Execution isolation** — dedicated executor and restricted mounts/environment/egress.
5. **Audit isolation** — trusted writer, tamper evidence, and Phoenix network separation.
6. **Outbound and supply-chain hardening** — SSRF controls, secure installer fallback, and
   corrected documentation.

Do not combine the identity migration, executor, and audit topology changes into one pull
request.

## Acceptance criteria

The epic is complete only when:

* arbitrary shell syntax cannot read or modify resources outside the caller's capability;
* concurrent users cannot influence each other's authorization identity;
* distinct issuer/subject pairs cannot resolve to the same partition;
* application or shell compromise cannot rewrite or silently forge audit history;
* metadata services, localhost, private networks, encoded IP forms, redirect pivots, DNS
  rebinding cases, and oversized responses are rejected;
* restart cannot be triggered remotely or without administrator authorization and CSRF
  protection;
* denied or malformed requests do not create filesystem state;
* installer secret generation fails closed without a secure RNG;
* migration and rollback are exercised against representative existing data;
* all existing tests and new adversarial tests pass;
* standard and sandbox Compose configurations validate;
* live container tests pass with a Docker daemon available;
* root and production dependency audits report no known vulnerabilities; and
* `gitnexus detect-changes` reports only the expected symbols and execution flows before
  each commit.

## Release policy

Emergency containment, request-scoped identity, and collision-resistant partitioning are
release blockers. Do not describe the deployment as secure for multi-user or untrusted
workloads until execution isolation, trusted audit storage, and controlled egress also meet
their acceptance criteria.
