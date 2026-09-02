# 🔒 Security Architecture & Sandbox Policies

DeepSeek Harness within this Docker stack is designed with strict multi-layered security controls to protect host data and API credentials.

---

## 🛡️ Security Layers

### 1. Process & Filesystem Isolation
* **Docker Container Boundary**: Agent execution occurs inside an isolated Linux container (`dsh-local`). The host filesystem is protected; only directories explicitly mounted (`./workspaces` and `./config`) are accessible.
* **Workspace Scoping**: Personas are configured to read and write files within `/workspaces`. Host paths outside explicit mounts cannot be accessed by the container.
* **Localhost Network Binding**: All exposed ports (`127.0.0.1:3080` for DSH Web UI and `127.0.0.1:6006` for Arize Phoenix) bind strictly to loopback interfaces, preventing external network and LAN exposure.

### 2. Hardening Recommendations for Untrusted Code
For deployments evaluating untrusted code:
* **Read-Only Workspace**: Mount workspaces with the `:ro` flag in `docker-compose.yml` when write access is not required.
* **Capability Dropping**: Add `cap_drop: [ALL]` and `security_opt: [no-new-privileges:true]` to container definitions.

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
