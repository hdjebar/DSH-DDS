# ✅ Milestone 1: Zero-Trust Network Egress, Model Failover & Telemetry Hardening

* **Status**: Completed & Verified
* **Release Target**: `v1.11.0`
* **Completed Date**: 2026-09-07
* **Maturity Level Achieved**: Level 3.45

---

## 🎯 Objectives Delivered

1. **Envoy Egress Forward Proxy Sidecar**:
   * Hardened Envoy sidecar in `docker-compose.sandbox.yml` with strict domain allowlists (ADR 0007 / ADR 0008). The milestone originally shipped v1.31; the current runtime uses digest-pinned v1.39.1 with connection-time CIDR filtering.
   * Restricts `mcp-fetch` to HTTP `GET`/`HEAD` methods with 10s timeouts; drops unauthorized subshell exfiltration with HTTP 403.
   * Prohibits access to cloud metadata endpoints (`169.254.169.254`) and Google OAuth endpoints.

2. **In-Flight Model Failover Gateway**:
   * Implemented `config/failover-gateway.mjs` as an in-process Cordis service (`ctx.provide('gateway')`).
   * Automatically switches upstream models on HTTP 429 / 503 errors in $<1.5\text{ s}$ without state loss.
   * Cascade chain: `gemini-2.5-flash` ➔ `openrouter/claude-3.5-sonnet` ➔ `openrouter/llama-3.3-70b-instruct`.

3. **Credential-Isolated Web Search**:
   * Zero-key resilient DuckDuckGo web search in `packages/dsh-dds-core/web-search.js`.
   * Eliminates the need for external API search keys or host Google Cloud OAuth tokens.

4. **Dynamic Plugin & MCP Lifecycle Governance**:
   * `config/dynamic-governance.mjs` enables runtime plugin and MCP installation while strictly preserving container `read_only: true`.
   * Intercepts tool paths with `canonicalizeWithAncestorRealpath()` to prevent traversal outside `/workspace`.

5. **Phoenix Cgroup & Retention Hardening**:
   * Enforced 2048M memory limit and 1.5 CPU caps for the `phoenix` container.
   * Added `scripts/prune_telemetry.sh` with 14-day rolling retention and automated SQLite vacuuming.
   * Standardized OTLP gRPC (`:4317`) and HTTP (`:4318`) collector endpoints.

---

## 🧪 Verification Evidence

* Tests: `tests/envoy_egress.test.mjs`, `tests/failover_gateway.test.mjs`, `tests/dynamic_governance.test.mjs`.
* All 169 test cases passing in `npm test`.
