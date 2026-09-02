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
* **Host Filesystem Isolation**: Normal workloads mount `./workspaces` at `/workspaces` and `./config` at `/root/.dsh`. Sandbox mode instead mounts configuration read-only at `/opt/dsh-config` and reconstructs `/root/.dsh` in tmpfs.
* **Workspace Scoping**: Sandbox workspaces are read-only. Only session transcripts and DSH JSON storage persist in a dedicated Docker volume; executable configuration and profiles remain disposable.

### 2. Credential & Token Protection
* **Environment Indirection**: All Model Context Protocol (MCP) server definitions in `persona.yaml` or `cordis.patch.yml` must reference credentials via `${VAR_NAME}` syntax rather than literal values.
* **Zero Hardcoded Secrets**: The repository strictly enforces that `.env` is ignored by `.gitignore`. The included `.env.example` provides non-functional structural placeholders.
* **Automated Distillation Sanitization**: The `./dsh.sh persona distill` engine automatically scrubs API keys (`sk-...`, `AIza...`, `ghp_...`/`github_pat_...`, Bearer tokens) from transcripts before generating persistent persona manifests.

### 3. Network & Proxy Architecture
* **Localhost Binding**: Host port exposure is strictly restricted to `127.0.0.1:3080` (DSH Gateway) and `127.0.0.1:6006` (Arize Phoenix), preventing unauthorized access across local area networks.
* **Telemetry Isolation**: Arize Phoenix runs locally on `http://phoenix:6006` within an isolated Docker bridge network. Telemetry spans, prompt traces, and token pricing are stored in local SQLite databases without egress to third-party clouds.
