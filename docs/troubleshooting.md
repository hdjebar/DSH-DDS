# ❓ Troubleshooting & Diagnostic Guide

This guide covers resolution steps for common issues in the DeepSeek Harness + Arize Phoenix Docker stack.

---

## 🔍 Fast Diagnostics with `doctor`

Before manual debugging, always run the built-in diagnostic tool:

```bash
./dsh.sh doctor
# or
docker compose exec dsh node /root/.dsh/doctor.mjs
```

---

## 🛠️ Common Issues & Resolutions

### 1. `CONTEXT_WINDOW_EXCEEDED: 400 status code (no body)` on Gemini Tool Calls
* **Root Cause**: Google AI Studio requires returning the reasoning `thought_signature` when `gemini-3.7-flash` or `gemini-3.6-flash` executes tools. If missing, Google returns HTTP 400.
* **Resolution**: DSH-DDS automatically patches `openai-completions.js` in `pi-ai` to cache and re-attach `extra_content.google.thought_signature`. If you rebuild or reinstall, ensure you are running image `dsh-local:latest` built from the current repository Dockerfile.

---

### 2. `Port 3080` or `Port 6006` Already in Use
* **Root Cause**: Another local process or previous container instance is occupying port 3080 or 6006.
* **Resolution**:
  1. Identify the blocking process:
     ```bash
     lsof -ti :3080,6006
     ```
  2. Stop old containers:
     ```bash
     ./dsh.sh down
     ```
  3. Or change `DSH_PORT` in `.env`:
     ```env
     DSH_PORT=3085
     ```

---

### 3. Missing Models in Arize Phoenix or DSH
* **Root Cause**: OpenRouter added new models after container boot.
* **Resolution**: Trigger the dynamic model synchronizer on demand:
  ```bash
  ./dsh.sh sync-models
  ```

---

### 4. GitHub MCP Server "Bad credentials" or "Resource not found"
* **Root Cause**: `GITHUB_PERSONAL_ACCESS_TOKEN` is missing, expired, or lacking repository permissions (especially for fine-grained PATs).
* **Resolution**:
  1. Generate a classic PAT (with `repo` scope) or fine-grained PAT with access to your target repositories at [GitHub Token Settings](https://github.com/settings/tokens).
  2. Add to `.env`:
     ```env
     GITHUB_PERSONAL_ACCESS_TOKEN=ghp_YourTokenHere
     ```
  3. Restart stack:
     ```bash
     ./dsh.sh restart
     ```

---

### 5. Phoenix Telemetry "Connection Reset by Peer" on Fresh Startup
* **Root Cause**: Phoenix uvicorn server takes ~3 seconds to initialize embedded database tables on cold boot.
* **Resolution**: Normal behavior during startup. The DSH healthcheck will automatically wait until both services are `healthy` before routing traffic.

---

### 6. Resetting Corrupted Sessions or Database Caches
* **Soft Reset** (clears ephemeral sessions without deleting keys):
  ```bash
  ./dsh.sh reset
  ```
* **Hard Reset** (rebuilds clean containers and re-initializes databases):
  ```bash
  ./dsh.sh reset --hard
  ```
