# 🎨 Prompt-Driven Workspace Customization Guide

This guide explains how to customize, extend, and tailor your **DeepSeek Harness** workspace **directly through conversational prompts** during chat sessions.

---

## 🧭 Customization Layers

```mermaid
flowchart TD
    PROMPT["💬 User Prompt\n(Web IDE / CLI / Headless)"] --> ACTION1["🔌 1. Discover & Install Plugins\n(via dsh-find-plugin)"]
    PROMPT --> ACTION2["🔌 2. Add MCP Tool Servers\n(via dsh-mcp-panel)"]
    PROMPT --> ACTION3["🧠 3. Create Custom Domain Skills\n(in config/skills/<name>/SKILL.md)"]
    PROMPT --> ACTION4["⚙️ 4. Tune Models & Samplers\n(via OpenRouter / Gemini)"]
    PROMPT --> ACTION5["🏠 5. Connect Local Models\n(Ollama / vLLM / LM Studio)"]
```

---

## 1. 🔌 Discovering & Installing Plugins via Prompts

Because this workspace includes **`dsh-find-plugin`** and **`dshmarket`**, you can prompt your agent to find and install community plugins dynamically:

### Example Prompts:
> 💬 *"Find and install a community plugin for database management."*  
> 💬 *"Search for DSH plugins that provide Python virtualenv inspection tools."*  
> 💬 *"Find plugins related to Kubernetes or Helm deployments on npm."*

---

## 2. 🔌 Connecting Model Context Protocol (MCP) Servers

You can instruct the agent to configure new MCP servers in `config/profiles/web/cordis.patch.yml`:

### Example Prompts:
> 💬 *"Add a local SQLite MCP server pointing to `/workspaces/app.db`."*  
> 💬 *"Configure a PostgreSQL MCP server using connection string `postgresql://user:pass@localhost:5432/mydb`."*

---

## 3. 🧠 Teaching Domain Skills via Prompts

To teach your agent specialized workflows, instruct it to create a skill:

### Example Prompt:
> 💬 *"Create a new skill named `python-fastapi-expert` that enforces Pydantic v2 schemas, type annotations, and async route handlers. Save it into `config/skills/python-fastapi-expert/SKILL.md`."*

The agent will format the YAML frontmatter and markdown instructions automatically.

---

## 4. 🏠 Connecting Local Self-Hosted Models (Ollama / vLLM)

You can add self-hosted local models running on your host machine or network directly to `config/cordis.patch.yml`:

### Example Configuration:
```yaml
- id: llm-pi-ai
  config:
    providers:
      ollama:
        displayName: "Local Ollama"
        api: openai-completions
        baseURL: "http://host.docker.internal:11434/v1"
        apiKeyEnv: OLLAMA_API_KEY # (Can be empty or arbitrary string)
        models:
          - id: "llama3.3:latest"
            name: "Ollama: Llama 3.3 70B"
            contextWindow: 131072
            maxTokens: 8192
```

---

## 5. 🔄 Applying Changes

After modifying configuration files or adding plugins:
```bash
./dsh.sh restart
# or verify with
./dsh.sh doctor
```
