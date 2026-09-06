# ADR 0006: Global Refactoring — Non-Root Confinement, Linux FHS Segregation, Native Patches, and In-Tree Cordis Core Plugin

* **Status**: Accepted & Implemented
* **Date**: 2026-09-06
* **Deciders**: DeepSeek Harness Architecture Team (`DSH-DDS`)
* **Consulted**: Security Engineering, DevSecOps, Platform Engineering
* **Informed**: All Persona Developers and System Operators

---

## 1. Context and Problem Statement

Over prior development iterations, DeepSeek Harness (`DSH-DDS`) accumulated operational fragility and technical debt:
1. **Container Root Execution (UID 0)**: Containers executed as `root` with default Linux capabilities, creating host permission collisions (`root:root` files in `./workspaces` and `./config`) and violating the Principle of Least Privilege.
2. **Path & Storage Monolith**: Host `./config` was mounted over the application home directory (`~/.dsh` / `/root/.dsh`), forcing ad-hoc tmpfs mounts and symlink chaining.
3. **Ad-Hoc Monkey-Patching Scripts**: Six runtime scripts (`patch-market-restart.mjs`, `patch-session-events.mjs`, `patch-bash-local.mjs`, `patch-pi-ai.mjs`, `patch-client-connection.mjs`, `patch_translations.mjs`) were executed via a hijacked `/usr/local/bin/pnpm` shell wrapper and container entrypoint regex replacements.
4. **Maintenance Drift**: Dual maintenance of canonical configuration files and embedded heredocs in `install_dsh.sh` introduced drift risks.
5. **Image Bloat**: Unstripped compilers (`g++`, `make`, `build-essential`) and desktop GUI libraries bloated the container image content size to 754 MB and disk footprint to 3.22 GB.

A comprehensive, global architectural refactoring was required to establish production-grade enterprise standards without breaking backwards compatibility or compromising regression test suites.

---

## 2. Decision Drivers

* **Zero-Trust Non-Root Security**: Eliminate all root execution in production containers, drop kernel capabilities, and prevent privilege escalation.
* **Linux Filesystem Hierarchy Standard (FHS)**: Clearly delineate immutable declarative configuration (`/etc/dsh`), mutable runtime state (`/var/lib/dsh`), ephemeral memory (`/run/dsh`, `/tmp`), and user workspaces (`/workspaces`).
* **Vendor-Standard Dependency Management**: Leverage official `pnpm.patchedDependencies` for upstream Node package mutations rather than dynamic post-install shell wrappers.
* **Inversion-of-Control (IoC) Extensibility**: Migrate custom runtime gateway behavior, lifecycle restart, model catalog sync, localization, and RBAC into a first-class native Cordis plugin (`@dsh-dds/core`).
* **Single Source of Truth**: Programmatically synchronize installer scripts (`install_dsh.sh`) directly from canonical source files.
* **Continuous Test Invariant**: Maintain 100% pass rate across the full test suite (`npm test`) at every step.

---

## 3. Considered Options

* **Option A (Status Quo + Hardened Wrappers)**: Retain the existing patch scripts and wrapper binaries, adding further checks and sudo workarounds. *Rejected*: Compounded technical debt, failed CIS Docker benchmarks, and left host escape vulnerabilities open.
* **Option B (Complete Upstream Fork)**: Hard-fork all `@deepseek-ai/*` packages and publish custom scoped npm packages. *Rejected*: Excessive ongoing maintenance overhead and loss of direct upstream bugfix tracking.
* **Option C (Enterprise Refactoring — Non-Root + FHS + Native pnpm Patches + Cordis Plugin)**: Adopted. Implement standard Linux non-root confinement, FHS volume segregation, native `pnpm.patchedDependencies`, in-tree `@dsh-dds/core` plugin, and single-source installer builder.

---

## 4. Decision Outcome

We selected **Option C**. The refactoring was designed and implemented across five distinct phases:

### Pillar 1: Non-Root Security & Linux FHS Segregation
* Provisioned dedicated system user and group `dsh:dsh` (UID/GID 1000) with home directory `/home/dsh`.
* Segregated filesystem boundaries:
  - `/etc/dsh:ro`: Read-only host `./config` mount.
  - `/var/lib/dsh:rw`: Stateful application runtime directories (`sessions`, `audit`, `storages`, `patch`, `personas`, `skills`, `cache`).
  - `/var/lib/dsh/profiles:rw,size=256m,mode=1777`: Sticky tmpfs overlay for dynamic plugin profile generation.
  - `/run/dsh` and `/tmp`: Hardened sticky tmpfs mounts (`mode=1777`).
* Enforced non-root execution, `cap_drop: [ALL]`, and `security_opt: [no-new-privileges:true]` across both `dsh` and `phoenix` services in `docker-compose.yml` and `docker-compose.sandbox.yml`.

### Pillar 2: Native Dependency Engine (`pnpm.patchedDependencies`)
* Extracted mutations into standard unified diffs under `config/profiles/web/patches/`:
  - `dsh-mnemon@0.4.4.patch` (workspace storage path resolution).
  - `@deepseek-ai__dsh-session@0.1.2.patch` (session events iterable getter fix).
  - `@earendil-works__pi-ai@0.1.2.patch` (Google Gemini thought signature interceptor).
* Configured `pnpm.patchedDependencies` in `config/profiles/web/package.json`.
* Retired and deleted the hijacked `/usr/local/bin/pnpm` wrapper, restoring the standard unadulterated package manager.

### Pillars 3 & 4: In-Tree Native Cordis Plugin (`@dsh-dds/core`) & In-Line RBAC PEP
* Developed `@dsh-dds/core` under `packages/dsh-dds-core/` and declared it in `config/profiles/web/cordis.patch.yml`:
  - **`gateway.js`**: Intercepts HTTP traffic on the native Cordis WebServer; recognizes trusted container bridge IPs (`172.16.0.0/12`, `10.0.0.0/8`, `192.168.0.0/16`); normalizes origin headers; provides authenticated `/dsh-dds/lifecycle/restart` and public `/dsh-dds/health`.
  - **`model-catalog.js`**: In-process `ModelCatalogService` dynamically registering upstream model specs, tracking pricing, and exposing `/dsh-dds/api/models/sync`.
  - **`localization.js`**: In-memory HTML stream tap via `ctx.webServer.tapIndex()`, eliminating on-disk minified JS patching.
  - **`rbac-interceptor.js`**: Dynamic `tool-execute` Policy Enforcement Point (PEP) validating persona permissions, containing filesystem access, provisioning workspace cases, and logging tamper-evident GRC audit records.

### Pillar 5: Packaging, Script Retirement & Image Slimming
* **Single-Source Installer Builder**: Created `scripts/build_installer.mjs` with `--check` parity verification, backed by `npm run build:installer` and `npm run verify:installer`.
* **Retirement of Legacy Scripts**: Permanently removed `patch-pi-ai.mjs`, `patch-session-events.mjs`, `patch-market-restart.mjs`, `patch-client-connection.mjs`, `patch_translations.mjs`, and `patch-bash-local.mjs`.
* **Multi-Stage Build Slimming**: Isolated C++ build tools (`build-essential`, `g++`, `make`) exclusively to the `builder` stage in `Dockerfile` and purged desktop GUI browser packages from the runtime.

---

## 5. Consequences & Quantitative Metrics

### Positive Consequences
* **Host Permission Integrity**: Files created in `./workspaces` and state volumes are owned by UID 1000, eliminating the need for `sudo` on host workstations.
* **CIS Docker Benchmark Compliance**: Zero root execution, zero Linux kernel capabilities, and privilege escalation disabled.
* **Deterministic Builds**: Dependency patching is handled natively by `pnpm`, completely decoupled from runtime entrypoints.
* **Image Size Reduction**:
  - Image content size reduced from **754 MB to 318 MB (58% reduction)**.
  - Image disk usage reduced from **3.22 GB to 1.54 GB (52% reduction)**.
* **Zero Script Proliferation**: Clean `config/` directory without ad-hoc `.mjs` patch files.

### Negative Consequences / Trade-offs
* Tmpfs directories required explicit `mode=1777` permissions in Compose configurations to avoid unprivileged user `EACCES` write errors.
* Dynamic service injection in Cordis required explicit `ctx.inject(['webServer'], ...)` to avoid static proxy getter exceptions.

---

## 6. Verification & Test Evidence

1. **Automated Test Suite**: 95/95 passing tests across 10 suites (`npm test`).
2. **Installer Parity Verification**: `npm run verify:installer` exits with code 0 and zero drift.
3. **Container Health & Non-Root Audit**:
   - `docker inspect --format '{{.Config.User}}' dsh-dds-dsh-1` returns `1000:1000`.
   - `GET http://127.0.0.1:3080/dsh-dds/health` returns `{"status":"healthy","user":1000}`.
   - Both `dsh` and `phoenix` services report `healthy` in Docker Compose.
