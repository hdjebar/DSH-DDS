# 🕹️ Standard Operations & CLI Manual

This document provides a reference for everyday operations, CLI commands, headless scripts, and maintenance tasks.

---

## 🚀 Quick Reference Commands (`./dsh.sh`)

| Command | Action |
| :--- | :--- |
| **`./dsh.sh up`** | Starts DSH and Arize Phoenix containers in the background. |
| **`./dsh.sh down`** | Stops all containers gracefully. |
| **`./dsh.sh restart`** | Restarts the complete container stack. |
| **`./dsh.sh logs`** | Streams unified real-time logs from all containers. |
| **`./dsh.sh doctor`** | Runs full health check on APIs, plugins, and endpoints. |
| **`./dsh.sh sync-models`** | Fetches and syncs latest OpenRouter & Google models. |
| **`./dsh.sh sessions`** | Lists all recorded interactive Web UI and CLI sessions with timestamps. |
| **`./dsh.sh persona [cmd]`** | Manages AI Personas (`list`, `create`, `distill`, `run`, `workflow`). |
| **`./dsh.sh cli`** | Opens an interactive terminal session inside the container. |
| **`./dsh.sh run "<prompt>"`** | Runs a one-shot autonomous task in headless mode. |
| **`./dsh.sh reset`** | Clears session caches and restarts the stack cleanly. |
| **`./dsh.sh status`** | Shows running container health status. |

---

## 🤖 Headless Automations & Scripting

The headless runner executes a single task autonomously and prints the result to `stdout`.

### Basic Usage
```bash
./dsh.sh run "review git diff in /workspaces and suggest improvements"
```

### Passing File Inputs & Overriding Models
```bash
# Override model to DeepSeek V3 (OpenRouter) on the fly via mounted patch
cat << 'EOF' > config/custom-model.patch.yml
- id: agent-default-model
  config:
    provider: openrouter
    model: deepseek/deepseek-chat
EOF

docker compose exec dsh dsh --profile headless \
  --patch /root/.dsh/custom-model.patch.yml \
  "analyze /workspaces/package.json"
```

---

## 🛡️ Declarative Workflow Execution (`DeclarativeWorkflowEngine`)

Execute 100% declarative workflow pipelines defined in `persona.yaml` through the authoritative native JavaScript orchestrator:

### Basic In-Container Execution
```bash
# Runs inside the running DSH container with Landlock LSM and dropped capabilities
./dsh.sh persona workflow security-auditor audit_code

# Run data analyst pipeline
./dsh.sh persona workflow data-analyst analyze_pipeline
```

### Offline Host Execution (Unsafe Override)
If the container is offline, workflows fail closed by default to prevent ambient host privileges escape. To explicitly run on host for local debugging:
```bash
./dsh.sh persona workflow security-auditor audit_code --force-host-unsafe
```

---

## 📊 Arize Phoenix Telemetry Operations

* **Dashboard**: `http://localhost:6006`
* **OTLP HTTP Endpoint**: `http://phoenix:6006/v1/traces`
* **GraphQL Endpoint**: `http://phoenix:6006/graphql`

### Querying Traces via REST
```bash
# Query active Phoenix projects
curl -s http://localhost:6006/v1/projects | jq .

# Query custom model providers
curl -s http://localhost:6006/v1/custom_model_providers | jq .
```

---

## 🔄 Upstream Upgrades

When a new version of DeepSeek Harness is released upstream:

```bash
# 1. Pull latest upstream images
docker compose pull

# 2. Rebuild local layer with pre-packaged plugins and patches
./dsh.sh build

# 3. Verify health
./dsh.sh doctor
```
