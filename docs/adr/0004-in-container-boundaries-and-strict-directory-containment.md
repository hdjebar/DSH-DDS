# ADR 0004: In-Container Workflow Boundaries, Strict Directory Containment, and Acyclic Policy Engine

* **Status**: Accepted
* **Date**: 2026-09-03
* **Deciders**: Principal Systems Architects
* **Consulted**: Senior Security & GRC Audits

---

## 1. Context and Problem Statement

Following the delivery of ADR 0003, a secondary adversarial architectural review revealed several boundary, authorization, and semantic integrity deficits:
1. **Execution Boundary Mismatch**: `./dsh.sh persona workflow` invoked host-side Node.js directly, escaping container dropped capabilities (`cap_drop: ALL`), read-only root filesystems, Landlock LSM sandbox confinement, and container volume mount perimeters.
2. **Confused Deputy & Target Substitution**: Capability adapters fell back to the current repository directory or `/tmp/dsh-reports` when container paths (`/workspaces`, `/root/.dsh/sessions`) were not found natively on developer hosts, violating the time-of-check/time-of-use contract.
3. **Incomplete RBAC Matching**: Prefix checking used naive `startsWith()` matching, allowing `/tmp/allowed` to authorize `/tmp/allowed-evil`. Read allowlists (`filesystem.read`) were also unverified on read actions.
4. **Non-Transactional ACM Semantics**: Gated steps (`approval_required`) marked steps as `GATED` but did not suspend execution, permitting subsequent forensic and reporting steps to execute unapproved.
5. **Circular Package Topology**: `persona.mjs` and `declarative-orchestrator.mjs` were circularly coupled.

---

## 2. Decision Drivers

* **In-Container Execution Boundary**: When the DSH container is running, workflows must execute **inside the container** via `docker compose exec dsh ...` so they inherit container isolation.
* **Acyclic Policy Architecture**: Extract an independent, reusable `config/rbac-policy.mjs` module containing parsing, validation, path resolution, RBAC policy enforcement, and GRC audit logging.
* **Strict Directory Boundary Containment**: Enforce that paths are either strictly equal to the allowed root or start with `<allowRoot>/` (preventing `/tmp/allowed-evil` bypasses).
* **Enforced Read Allowlists**: Enforce `filesystem.read` allowlists on read actions (`fetch_sources`, `inspect_sqlite`, `read_catalog`, `forensic_investigation`, `inspect_tabular`, `read_file`).
* **Canonical Path Resolver (`resolvePath`)**: Transparently map Docker volume mount roots (`/workspaces` -> `./workspaces`, `/root/.dsh` -> `./config`) when operating in host emulation/test mode, eliminating silent fallbacks to `/tmp` or working directories.
* **ACM Workflow Suspension**: A step with `approval_required: true` without explicit `approved: true` context suspends workflow execution (`status: 'SUSPENDED_APPROVAL_REQUIRED'`), halting all subsequent steps.

---

## 3. Decision Outcome

### 3.1 Host CLI In-Container Dispatch (`dsh.sh`)
* Updated `dsh.sh::persona` handler:
  When invoking `workflow` or `wf`, `dsh.sh` checks if the `dsh` container is active; if active, execution is delegated into the container: `docker compose exec -T dsh node /root/.dsh/persona.mjs "$@"`.

### 3.2 Acyclic Policy Engine (`config/rbac-policy.mjs`)
* Extracted `isContainedWithin`, `resolvePath`, `enforceRbacPolicy`, `logGrcAuditEvent`, `parseYaml`, `parsePersonaYaml`, and `validateSlug` into an acyclic module. Both `persona.mjs` and `declarative-orchestrator.mjs` import from this shared contract.

### 3.3 Strict Directory Containment & Read Allowlists
* `isContainedWithin(targetPath, allowRoot)` guarantees that target is either equal to allowRoot or is within `allowRoot + path.sep`.
* `filesystem.read` allowlists are enforced for all read actions.

### 3.4 ACM Workflow Suspension
* Workflows immediately pause execution upon encountering an unapproved gated step, preventing subsequent steps from executing without human authorization.

---

## 4. Consequences

### Positive
* **Identical Security Perimeter**: CLI execution (`persona run`) and workflow execution (`persona workflow`) both respect the container sandbox when running.
* **No Path Ambiguity**: `resolvePath` ensures container volume paths cleanly map to mounted directories on host without arbitrary substitutions.
* **Guaranteed Least Privilege**: Both read and write filesystem perimeters are strictly verified against directory boundaries.
