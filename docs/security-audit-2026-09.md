# Consolidated Security Audit — September 2026

Record of a four-pass adversarial audit of DSH-DDS covering the `@dsh-dds/core` Cordis
plugin, the RBAC policy engine, the shell entrypoints, and the container and compose
topology. Each pass re-audited the previous pass's remediations; two passes found
regressions introduced by the fixes themselves, which is why the record is kept in full
rather than collapsed into a list of resolved items.

| | |
| :--- | :--- |
| **Baseline** | `b6ee34a` |
| **Passes** | 5 (findings → remediation → re-audit → remediation → self-review) |
| **Test suite** | 167 passing at close (145 at baseline, plus 22 regression tests added) |
| **Method** | Source review plus behavioural probes: each finding below marked *verified* was reproduced by executing the affected code path, not inferred from reading. |
| **Not covered** | No Docker daemon was available. Every `Dockerfile`, `entrypoint.sh`, and compose change is reviewed statically only. |

---

## 1. Findings and disposition

Severity is the risk at the time of discovery. "Pass" is the audit pass that found it.

### Fixed

| ID | Pass | Sev | Finding | Resolution |
| :--- | :---: | :---: | :--- | :--- |
| A-01 | 1 | High | `iam.js` honoured `x-dsh-user-roles: admin` from any client; admin bypasses every tenant boundary. Auth was off by default. *(verified)* | Header identity now requires `DSH_TRUST_PROXY_HEADERS=true` **and** a trusted socket peer. JWT pinned to `HS256`. (SEC-14) |
| A-02 | 1 | High | `ByokVault` fell back to a master key literal committed to the public repo; a stored vault was decrypted using only that constant. *(verified)* | Fail-closed constructor requiring `DSH_VAULT_MASTER_KEY` ≥ 32 chars; payload `v2`; v1 blobs refused; installer generates the key; `doctor` checks it. (SEC-13) |
| A-03 | 1 | High | The in-line PEP intercepted tool names while the policy engine validated workflow verbs. Unmapped tools defaulted to `'execute'` → every shell call hard-denied. *(verified)* | `TOOL_ACTION_MAP` + `KNOWN_POLICY_VERBS`, null-prototype map, tool-name-first precedence. (SEC-15) |
| A-04 | 1 | Med | `parseYaml` returned `{}` when the YAML engine was missing, silently stripping every persona's RBAC contract. | `getYamlEngine()` throws. Note this produced regression B-01. |
| A-05 | 1 | Med | Installer silently downgraded an unresolvable pinned ref to the moving `main` branch. | Inverted: fails closed unless `DSH_ALLOW_REF_FALLBACK=1`. |
| A-06 | 1 | Med | `/app` was owned by `dsh:dsh`, so the agent could rewrite the `NODE_OPTIONS` loader and its own policy code. | `/app` root-owned `0755`. Extended by D-03. (SEC-16) |
| A-07 | 1 | Med | Envoy egress sidecar pinned to the mutable tag `v1.31-latest`. | Pinned by SHA256 digest. |
| A-08 | 1 | Low | Unguarded `new URL(req.headers.referer)` in the restart handler; malformed `Referer` threw inside an async handler. | Wrapped in `try/catch`. |
| A-09 | 1 | Low | Restart endpoint trusted all of RFC1918 and link-local. | Narrowed to `isLoopbackOrLocalBridgeIp`. |
| A-10 | 1 | Low | Vault REST body accumulated unbounded. | 64 KB cap, socket destroyed on overflow. |
| A-11 | 1 | Low | `thoughtSignatures` map grew for the process lifetime. | Bounded at 1000, FIFO eviction. |
| A-12 | 1 | Low | `dsh.sh approve` interpolated the instance id into an `execSync` shell string. | `execFileSync` with an argv array. |
| A-13 | 1 | Low | `web-search` treated 3xx as success and accumulated the body unbounded. | Redirects followed (max 3) with an HTTPS + `*.duckduckgo.com` allowlist; 512 KB cap. |
| B-01 | 2 | **High** | The A-04 fix inverted the failure mode: a module-scope throw made the engine import fail, `getRbacEngine()` swallowed it, and the handler returned — allowing the action. Fail-closed became fail-**open**. *(verified: admin `bash` on `/etc/shadow` returned ALLOWED)* | Engine unavailability now throws `Policy engine unavailable`. |
| B-02 | 2 | High | Action precedence `MAP[action] ?? action ?? MAP[toolName]` let an unmapped `action` short-circuit the tool-name mapping, so `{toolName:'bash', action:'execute'}` still hard-denied. *(verified)* | Tool name resolved first, then the action map, then a known-verb allowlist. |
| B-03 | 2 | Med | With the path-prefix guard removed, a shell **command string** was validated as a filesystem path — every `bash` call denied on a string that was never a path. *(verified)* | `command` and `workdir` separated from `target`; `run_shell` evaluates the workdir against the write allowlist. |
| B-04 | 2 | Med | The lazy vault `Proxy` deferred construction past the route's `try/catch`, so a missing master key threw out of the handler instead of returning `VAULT_UNAVAILABLE`. *(verified)* | Construction forced inside the guard; `headersSent` checked. |
| B-05 | 2 | Low | Sandbox `/run` tmpfs loosened to `1777`. | Restored to `0770,uid=1000,gid=1000`. |
| D-01 | 4 | **High** | `getGrcAuditLogPath()` resolved to the container-internal `/var/log/dsh` because `DSH_AUDIT_LOG_FILE` was set nowhere; the mounted `./config/audit` was never written to, and the docs asserted host persistence "across all run modes". *(verified)* | Standard mode pins `DSH_AUDIT_LOG_FILE` onto the mounted volume; sandbox mode drops the host bind by design; `doctor` reports the resolved path; docs corrected. |
| D-02 | 4 | High | The documented `trace_id` correlation did not exist on the PEP path: all three call sites wrote `trace_id: null`, and the Phoenix span then derived its id from a millisecond timestamp. *(verified: `0000000000000000000001a07df648e6`)* | The PEP generates a 128-bit id per action via `crypto.randomBytes(16)` and honours a caller-supplied one. |
| D-03 | 4 | Med | Root ownership of `/app` was bypassable: `NODE_PATH` resolved bare specifiers through the dsh-writable profile tree, where `entrypoint.sh` re-created the `@dsh-dds/core` symlink at every boot as `dsh`. | Runtime re-link removed (the build-time link covers both modes); `@dsh-dds` scope root-owned. |
| D-04 | 4 | Med | The installer fetched and extracted the release archive with no checksum and swallowed `tar` failures. | Verified against the published `SHA256SUMS`, fails closed unless `DSH_ALLOW_UNVERIFIED_ARCHIVE=1`; extraction errors fatal. |
| D-05 | 4 | Med | `logGrcAuditEvent` swallowed both sink failures in bare `catch {}` while the docs claimed a "fail-closed append". | Throws `GRC_AUDIT_WRITE_FAILED` when every sink fails, so an unrecordable decision cannot execute. |
| D-06 | 4 | Low | Doc inaccuracies: non-existent Phoenix tag `version-20.5.0`; Phoenix storage described as a named volume (it is a bind mount); retention asymmetry (14-day spans vs. "permanent ledger") unstated. | Corrected in `security.md`. |

### Found in pass 5 (self-review of the pass-4 remediation)

| ID | Pass | Sev | Finding | Resolution |
| :--- | :---: | :---: | :--- | :--- |
| E-01 | 5 | Med | The D-05 fail-closed append applied to *every* call site, including three in `declarative-orchestrator.mjs` whose outcome was already a refusal. A failing audit sink therefore replaced `Zero Trust RBAC Policy Violation [RBAC_WRITE_UNAUTHORIZED]` with `GRC_AUDIT_WRITE_FAILED`, and converted a resumable approval gate (`GATED`) and a recoverable loop trap (`LOOP_DETECTED`) into hard failures. *(verified)* | `logGrcAuditEventBestEffort` added for paths that already deny, gate, or recover: the original outcome wins and the write failure is reported on stderr. `logGrcAuditEvent` stays fail-closed for grants. |

### Accepted with documented limits

| ID | Pass | Subject | Position |
| :--- | :---: | :--- | :--- |
| C-01 | 3 | The `run_shell` command deny-check is a substring blocklist. *(verified evasion: `cat /e""tc/passwd` passes)* | Kept as a tripwire (`RBAC_SUSPICIOUS_COMMAND`), not enforcement. Confinement comes from the workdir allowlist plus the container controls. A test pins the known evasion so the limitation cannot be silently reinterpreted. |
| C-02 | 4 | The Phoenix span export is fire-and-forget: 1.5 s abort, swallowed error, subset of fields (`workflow` and full timestamps do not cross). | Accepted — telemetry must not block execution. Documented so Phoenix is not mistaken for a complete ledger. |
| C-03 | 4 | Bare-specifier shadowing outside the `@dsh-dds` scope. | The profile tree must stay writable for profile installs. Contained by the read-only rootfs in sandbox mode only; SEC-16 states this. |
| C-04 | 4 | `appendFileSync` is a write syscall, not `fsync`. | Ordering guaranteed, durability across host crash is not. Stated rather than overclaimed. |

---

## 2. Open items

1. **The PEP has never been observed running.** Every behavioural result above was produced
   against a hand-constructed `actionContext`. Whether `ctx.before('tool-execute')` fires in
   this harness, and which fields it carries, is unverified — and `resolvedAction` returns
   `null` (deny-all) if `toolName` is absent. One line at `rbac-interceptor.js`:

   ```js
   console.warn('[PEP]', JSON.stringify({ keys: Object.keys(actionContext), toolName: actionContext.toolName, action: actionContext.action }));
   ```

   plus one real session settles whether SEC-15 protects anything. This is the highest-value
   remaining action and it is not answerable from static review.

2. **`SHA256SUMS` must be published per release.** D-04 fails closed by default; until the
   asset exists for a tag, remote installs of that tag need `DSH_ALLOW_UNVERIFIED_ARCHIVE=1`.

3. **Container changes are statically reviewed only.** The `@dsh-dds` chown and the removed
   entrypoint re-link (D-03) need one `./dsh.sh build && ./dsh.sh up` to confirm the plugin
   still resolves.

4. **SEC-01 remains open by design.** The Web UI and Phoenix are unauthenticated and
   contained only by loopback binding. Anything beyond a single-operator host needs an
   authenticating reverse proxy.

---

## 3. What the passes suggest about the codebase

Three of the five passes found that a remediation had introduced a new defect, and in one case
(B-01) the fix inverted the property it was meant to guarantee. Three observations follow:

- **Fail-closed is a property of the whole path, not of one function.** A-04 made the policy
  module throw, which was correct in isolation; the caller's `catch` turned it into a bypass.
  Changes to enforcement should be tested end-to-end from the interceptor, not at the unit
  that changed.
- **Tests that construct their own inputs cannot detect an input-shape mismatch.** The PEP
  suite passed throughout while A-03 and B-02 made the enforcement point deny-everything,
  because every test supplied a policy verb the map already knew.
- **Fail-closed is not uniformly correct.** E-01: applying it to paths that already
  refuse, suspend, or recover destroyed information and turned graceful outcomes into
  hard failures. The property belongs on the path where a *grant* would otherwise
  execute unrecorded, not on every call site that happens to write a record.
- **Documentation drifted ahead of the code more than once.** D-01 and D-02 were both docs
  asserting guarantees the code did not provide, in the section auditors are most likely to
  read. Claims about persistence, correlation, and fail-closed behaviour should carry a test
  that fails when the claim stops being true — the pattern used for D-01, D-02, D-05 and C-01.
