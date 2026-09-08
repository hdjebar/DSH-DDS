# 📦 Module 04: Package Management & Upstream Evolution

> **Document ID**: `DSH-DDS-REF-04`  
> **Target**: `pnpm.patchedDependencies`, upstream version upgrades (`@deepseek-ai/*`, `cordis`), installer single-source build, container footprint slimming

---

## 1. The Package Management Fragility Problem

In the legacy architecture:
1. When `@deepseek-ai/dsh` or upstream packages contained bugs (e.g. `session.events` iterable error or Google thought_signature extraction in `pi-ai`), custom Node scripts (`patch-session-events.mjs`, `patch-pi-ai.mjs`) used string replacement on files inside `node_modules/`.
2. When `dshmarket` installed or updated a plugin, `pnpm add` re-extracted packages from the pnpm store and clobbered the patched files on disk.
3. To counter this, `/usr/local/bin/pnpm` was replaced with a hijacked shell script wrapper that re-executed all patch scripts after every pnpm command.
4. Any minor version update from DeepSeek changed variable names or line formatting, immediately breaking the regex string replacements.

---

## 2. Target Solution: Native `pnpm.patchedDependencies`

`pnpm` provides a native, built-in mechanism for maintaining vendor patches: `pnpm patch <pkg>`.

```
config/profiles/web/
├── package.json
└── patches/
    ├── @deepseek-ai__pi-ai@0.1.2.patch
    └── @deepseek-ai__dsh-session@0.1.2.patch
```

### In `package.json`:
```json
{
  "name": "dsh-profile-web",
  "pnpm": {
    "patchedDependencies": {
      "@deepseek-ai/pi-ai@0.1.2": "patches/@deepseek-ai__pi-ai@0.1.2.patch",
      "@deepseek-ai/dsh-session@0.1.2": "patches/@deepseek-ai__dsh-session@0.1.2.patch"
    }
  }
}
```

### Architectural Benefits:
1. **Engine-Native**: `pnpm` automatically applies the unified git diff whenever `pnpm install` or `pnpm add` executes.
2. **Persistence Across Dynamic Installs**: When a user installs a new plugin in the Web UI, `pnpm` automatically preserves and reapplies all patches as part of its dependency resolution graph.
3. **Zero Wrappers**: Deletes `/usr/local/bin/pnpm` wrapper script. Standard unadulterated `pnpm` binary is used.
4. **Zero Runtime Scripts**: Deletes `config/patch-*.mjs` scripts.

---

## 3. Upstream Evolution Strategy: Handling New DeepSeek & Cordis Versions

When DeepSeek releases newer versions of its npm packages (e.g. `@deepseek-ai/dsh` moving from `0.1.2-rc.1` to `0.2.0` or `1.0.0`, including newer `cordis` versions):

```
                                  UPSTREAM UPGRADE IMPACT MATRIX
  ──────────────────────────────────────────────────────────────────────────────────────────────────
   Dimension               Old Monkey-Patching System              New Refactored Architecture
  ──────────────────────────────────────────────────────────────────────────────────────────────────
   Regex/String Matching   ❌ FAILS IMMEDIATELY                   ✅ ZERO REGEX DEPENDENCY
                           Any changed whitespace, variable name,  Interacts strictly with stable
                           or import breaks patch scripts.         Cordis service injection APIs.

   pnpm Engine             ❌ Clobbers patched files on disk      ✅ NATIVE & DETERMINISTIC
                           Requires wrapper to re-patch.           pnpm detects version bumps and
                                                                   warns if a patch is obsolete.

   Upstream Bug Fixes      ❌ Manual removal of JS scripts        ✅ SEAMLESS RETIREMENT
                           Patch scripts must be rewritten.        Delete the .patch file from
                                                                   package.json once upstream fixes it.

   Container & Security    ❌ Trapped in /root/.dsh               ✅ UPSTREAM-AGNOSTIC
                           Binds host to container UID 0.          Linux FHS and UID 1000 run
                                                                   cleanly regardless of package version.
```

### Upstream Upgrade Workflow
1. **Detecting Upstream Upgrades**:
   Update `package.json` to the new version:
   ```bash
   pnpm up @deepseek-ai/dsh@latest
   ```
2. **Automated Patch Retirement**:
   If the new DeepSeek version already resolved `session.events` or loopback handling, `pnpm` will report:
   ```
   [WARN] The following patches did not apply cleanly:
   patches/@deepseek-ai__dsh-session@0.1.2.patch
   ```
   Retiring the patch is simply removing its line from `package.json`.
3. **Version-Gated Core Adapter**:
   If route registration or internal signatures evolve in `@deepseek-ai/dsh`, `@dsh-dds/core` handles the variance in a single TypeScript class using semantic version checks (`semver.gte(dshVersion, '0.2.0')`), keeping the rest of the codebase untouched.

---

## 4. Single-Source Packaging (Eliminating the Heredoc Mirror)

### The Anti-Pattern
Currently, `install_dsh.sh` duplicates `Dockerfile`, `docker-compose.yml`, and `package.json` as multi-hundred-line embedded heredocs. Every repository update requires double-editing both the canonical file and the heredoc inside `install_dsh.sh`.

### Target Solution: Release Builder Pipeline
Introduce a single-source build command (`npm run build:installer`):
* Reads the canonical files (`Dockerfile`, `docker-compose.yml`, `config/`).
* Bundles them into an installer archive or injects them deterministically into `install_dsh.sh` during automated CI release tagging.
* Eliminates human error and manual double-editing.

---

## 5. Container Footprint Stripping (3.22 GB → ~800 MB)

### Diagnostic of Bloat
The current `dsh-local:latest` image consumes 3.22 GB because:
* Build compilers (`make`, `g++`, `build-essential`) are left inside the runtime stage (`runner`).
* `playwright install-deps chromium` installs hundreds of megabytes of desktop GUI libraries (X11, GTK, audio drivers).

### Multi-Stage Stripping Specification
1. **Stage 1 (`builder`)**: Compiles native C++ extensions (`node-gyp`, `node-pty`).
2. **Stage 2 (`runner`)**: Copies only production `node_modules` from builder.
3. Install only headless browser essentials or decouple Playwright into an optional lightweight sidecar container.
4. **Result**: Slashing runtime container image size from 3.22 GB to **~800 MB** (~75% reduction), drastically improving container pull and boot times.
