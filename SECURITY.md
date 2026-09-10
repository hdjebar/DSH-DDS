# 🔒 Security Policy & Trust Boundaries

This document defines the security boundaries, vulnerability reporting procedure, and credential management standards for **DeepSeek Harness (DSH)**.

---

## 🛡️ Supported Versions

Only the current `main` branch receives active security updates and vulnerability patches:

| Version / Branch | Supported | Notes |
| :--- | :---: | :--- |
| `main` | ✅ Yes | Actively patched |
| Prior release tags | ❌ No | Please upgrade to latest `main` |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability or potential credential exposure within this repository, **please do not open a public GitHub issue**.

Instead, report it via:
* **Private Security Advisory**: Use [GitHub Security Advisories](https://github.com/hdjebar/DSH-DDS/security/advisories/new).
* **Direct Email Contact**: Send details and reproduction steps to the repository maintainer.

All reports will be acknowledged within 48 hours, and patches will be deployed following coordinated disclosure.

---

## 🏛️ Security Architecture & Trust Boundaries

### 1. Container & Filesystem Isolation
* **Linux FHS Segregation**: Normal workloads mount `./config` read-only at `/etc/dsh:ro` and mutable state at `/var/lib/dsh:rw` (UID 1000, `cap_drop: ALL`, `no-new-privileges: true`, 2 CPU / 4GB cgroup limits). Developer live mounts are isolated to `docker-compose.dev.yml`.
* **Sandbox Mode**: Sandbox workloads mount configuration read-only at `/opt/dsh-config:ro`, enforce a read-only rootfs (`read_only: true`), keep workspaces strictly read-only (`./workspaces:ro`), run with `network_mode: none`, and isolate session state to the dedicated named volume `sandbox-session-state`. The DSH application has no audit mount; authenticated receipts are sent to the external `audit-writer`, which alone owns `./config/audit` and checkpoint storage. All frontier credentials are explicitly blanked out.

### 2. Credential & Token Protection
* **Environment Indirection**: All Model Context Protocol (MCP) server definitions in `persona.yaml` or `cordis.patch.yml` must reference credentials via `${VAR_NAME}` syntax rather than literal values.
* **Zero Hardcoded Secrets**: The repository strictly enforces that `.env` is ignored by `.gitignore`. The included `.env.example` provides non-functional structural placeholders.
* **Automated Distillation Sanitization**: The `./dsh.sh persona distill` engine automatically scrubs API keys (`sk-...`, `ghp_...`, Bearer tokens) from transcripts before generating persistent persona manifests.

### 3. Network & Proxy Architecture
* **Localhost Binding**: Host port exposure is strictly restricted to `127.0.0.1:3080` (DSH Gateway) and `127.0.0.1:6006` (Arize Phoenix), preventing unauthorized access across local area networks.
* **Telemetry Isolation**: Arize Phoenix runs locally on `http://phoenix:6006` within an isolated Docker bridge network. Telemetry spans, prompt traces, and token pricing are stored in local SQLite databases without egress to third-party clouds.
