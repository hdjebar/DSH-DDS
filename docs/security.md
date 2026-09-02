# 🔒 Security Architecture & Sandbox Policies

DeepSeek Harness within this Docker stack is designed with strict multi-layered security controls to protect host data and API credentials.

---

## 🛡️ Security Layers

### 1. Process & Filesystem Isolation
* **Docker Container Boundary**: Agent execution occurs inside an isolated Linux container (`dsh-local`). The host filesystem is protected; only directories explicitly mounted (`./workspaces` and `./config`) are accessible.
* **Workspace Boundary Containment**: The agent runtime enforces file operation boundaries restricted to `/workspaces`. System paths outside the workspace and configuration mounts are protected.
* **Localhost Network Binding**: All services (`3080` for DSH Web UI and `6006` for Arize Phoenix) bind strictly to `127.0.0.1`, preventing exposure across local area networks (LAN / Wi-Fi).

### 2. Sandbox Permission Modes
DeepSeek Harness enforces configurable sandbox access policies:
* **`workspace-write` (Default)**: File creation, edits, and deletions are strictly restricted to `/workspaces`.
* **`workspace-read` (Sandbox Profile)**: Read-only access to workspace files with `network: false` outbound egress restrictions.

### 3. API Credential Protection
* **Environment Variable Isolation**: Sensitive API keys (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `PHOENIX_API_KEY`) are passed via environment variables and never written into version-controlled files.
* **`.gitignore` Enforcement**: The repository `.gitignore` blocks `.env`, session databases, temporary SQLite locks (`.db-wal`, `.db-shm`), and local storage logs from being committed.

### 4. Phoenix Local Telemetry Privacy
* **100% On-Premise / Local**: Arize Phoenix runs locally on `http://localhost:6006`. No traces, prompts, or model outputs are transmitted to external clouds.

---

## 📋 Best Practices Checklist

- [x] Keep `.env` out of git commits.
- [x] Use fine-grained GitHub Personal Access Tokens with restricted repository permissions.
- [x] Configure hard monthly spending caps on [Google AI Studio](https://aistudio.google.com/) and [OpenRouter](https://openrouter.ai/).
- [x] Run `./dsh.sh doctor` periodically to verify credential health and sandbox compliance.
