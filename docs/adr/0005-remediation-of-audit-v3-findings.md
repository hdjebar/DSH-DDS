# ADR 0005: Remediation of Architectural & Security Audit v3 Findings

* **Status**: Accepted
* **Date**: 2026-09-03
* **Deciders**: Principal Systems Architects
* **Consulted**: Senior Security & GRC Audits

---

## 1. Context and Problem Statement

Following the delivery of ADR 0004, an adversarial structural audit (`REPOSITORY_AUDIT_V3.md`) identified 9 concrete findings across the 4W1H + GRC taxonomy:
1. **F-01 (High/Medium)**: Interactive DSH prompt loop bypassed persona RBAC when accessing subprocess tools in standard mode.
2. **F-02 (High)**: Write-boundary escape via symlinked ancestor pivots (`allowed/pivot/escaped.json`) when target files did not exist yet, and ambient offline host execution fallback.
3. **F-03 (High)**: Supply chain vulnerability from unpinned global `pnpm` in Dockerfile and unpinned GitHub Actions.
4. **F-04 (Medium)**: Simulated adapters that declared effects (`verify_endpoint`, `forensic_investigation`, `contain_threat`, `inspect_tabular`) without real execution.
5. **F-05 (Medium)**: Single-state audit decisions where gated workflows were logged as `GRANTED` before execution.
6. **F-06 (Medium)**: Broken clean-room installer `fetch_or_copy_file()` where download was inside the `[ -f "$rel_path" ]` branch.
7. **F-07 (Medium)**: Scope flags (`recursive`, `workspace`) were excluded before RBAC authorization, allowing unverified directory scanning.
8. **F-08 (Medium)**: Assertion-shaped test harness lacking clean-room installer testing and symlink escape verification.
9. **F-09 (Low)**: CLI profile `pnpm-lock.yaml` contained two concatenated YAML documents.

---

## 2. Decision Drivers

* **Fail-Closed Container Boundary**: Eliminate ambient host execution for workflows unless explicitly demanded via `--force-host-unsafe`.
* **Symlink Ancestor Canonicalization**: Canonicalize the nearest existing ancestor with `fs.realpathSync()` for non-existent targets and detect symlink traversal escapes (`RBAC_SYMLINK_ESCAPE`).
* **Prior Concrete Scope Resolution**: Resolve logical scopes into concrete filesystem targets before invoking `enforceRbacPolicy()`.
* **Truthful Capability Adapters**: Execute real cryptographic hashing (SHA-256), actual endpoint probes with timeouts, real tabular inspections, and persistent containment ledgers.
* **Multi-State GRC Auditing**: Explicitly record `GRC_STEP_GATED` state when an execution is suspended pending human approval.
* **Clean-Room Installer**: Implement true copy-else-download logic and assert clean-room installation via automated tests.
* **Supply-Chain Pinning**: Pin `pnpm@10.5.2` and GitHub Actions by immutable release tags.

---

## 3. Decision Outcome

### 3.1 Symlink Traversal Protection & Ancestor Canonicalization (`config/rbac-policy.mjs`)
* Implemented `canonicalizeWithAncestorRealpath()` to resolve the realpath of the nearest existing ancestor directory for new files.
* Implemented `checkSymlinkEscape()` to detect intermediate symlinks pointing outside the allowlist root.
* Enhanced `isContainedWithin()` to resolve canonical realpaths for macOS/Linux system symlinks (`/var` -> `/private/var`).

### 3.2 Offline Host Fallback Elimination (`dsh.sh`)
* `./dsh.sh persona workflow` now strictly requires the `dsh` container to be running. If offline, it fails closed with an informative error message unless `--force-host-unsafe` is explicitly passed.

### 3.3 Prior Concrete Resolution of Logical Scopes (`config/declarative-orchestrator.mjs`)
* In `executeStep()`, `recursive` and `workspace` scopes are resolved to `currentContext.workspace || resolvePath('/workspaces')` **before** calling `enforceRbacPolicy()`.

### 3.4 Truthful Capability Adapters
* `verify_endpoint`: Performs actual HTTP fetch probes with 1.5s timeout; returns reachability and status code.
* `forensic_investigation`: Computes real SHA-256 hashes of collected artifacts.
* `contain_threat`: Writes persistent JSON containment ledgers to isolated airgap paths.
* `inspect_tabular`: Parses actual CSV lines and headers from dataset files.

### 3.5 Installer Clean-Room Provisioning & Single-Document Lockfile
* Fixed `install_dsh.sh` branching so missing assets are downloaded via `curl` from GitHub.
* Added `tests/installer_clean_room.test.mjs` verifying complete isolated installation.
* Cleaned `config/profiles/cli/pnpm-lock.yaml` to a single valid YAML document.
* Pinned `pnpm@10.5.2` in `Dockerfile` and `install_dsh.sh`.

---

## 4. Consequences

### Positive
* **Zero Symlink Escapes**: Workflows cannot pivot out of allowlisted roots using existing or intermediate symlinks.
* **Truthful Observability**: Phoenix traces and GRC audit records reflect actual execution states, cryptographic hashes, and explicit `GATED` status.
* **Reproducible Supply Chain**: Pinned package managers and action versions protect against upstream supply chain drift.
* **Validated Clean-Room Bootstrapping**: Standalone installer execution is verified by automated testing.
