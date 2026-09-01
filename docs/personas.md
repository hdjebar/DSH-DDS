# 🎭 AI Agent Personas & Profile Specialization

A **Persona** in DeepSeek Harness is a tailored, domain-specific AI worker configured with specialized **domain skills**, **scoped MCP tools**, a **calibrated default model**, and **automated headless recipes**.

---

## 🧭 Anatomy of a Persona

```mermaid
flowchart LR
    subgraph Persona ["🎭 Tailored AI Persona"]
        SKILL["🧠 Domain Skill\n(config/skills/<name>/SKILL.md)"]
        TOOLS["🔌 Scoped MCP Tools\n(Database, GitHub, Web Search)"]
        MODEL["⚙️ Calibrated Model\n(Cost/Speed/Reasoning fit)"]
        RECIPE["🤖 Headless Recipe\n(./dsh.sh run '...')"]
    end
    Persona --> TASK["🚀 Specialized Autonomous Execution"]
```

A well-designed persona brings together four components:
1. **Domain Skill (`SKILL.md`)**: Reusable rules, constraints, and examples governing agent behavior.
2. **Curated Tools & MCP Servers**: Scoped tools relevant to the domain (e.g. SQLite, GitHub, Context7).
3. **Model Routing**: Selecting the optimal model for the domain (e.g. DeepSeek R1 for logic, Gemini 3.7 Flash for speed/multimodal, DeepSeek V3 for cost-effective coding).
4. **Automated Headless Recipe**: A repeatable CLI command for recurring background execution.

---

## 🛠️ Worked Persona Examples

---

### 1. 📊 The "Data Analyst & SDMX Engineer" Persona

Specialized in querying SQL databases, analyzing statistical datasets (e.g., LUSTAT, Eurostat), and generating executive summaries.

#### Step 1: The Domain Skill (`config/skills/data-analyst/SKILL.md`)
```markdown
---
name: data-analyst
description: Use when querying, cleaning, or summarizing tabular/SQL data and statistical datasets.
---

# Data Analyst & Statistical Engineer

## Guidelines & Rules
1. Always run read-only queries (`SELECT`) first; never perform `DROP` or destructive operations.
2. Summarize result sets over 20 rows into clean markdown tables with key takeaways.
3. Flag columns with >15% NULL or missing values before aggregating.
4. For statistical API endpoints (SDMX/LUSTAT/Eurostat), format dimensions cleanly.

## Output Format
* 📈 **Executive Summary** (2-3 sentences)
* 📊 **Structured Data Table**
* 💡 **Key Insights & Anomalies**
```

#### Step 2: Optimal Model Selection
* **Model**: `deepseek/deepseek-chat` (DeepSeek V3) or `gemini-3.7-flash` for fast, cost-effective data extraction.

#### Step 3: Headless Execution Recipe
```bash
./dsh.sh run "Using the data-analyst skill, analyze sales trends in /workspaces/data.csv and write an executive summary to reports/sales_q3.md"
```

---

### 2. 🛡️ The "Security & Code Review Auditor" Persona

Specialized in auditing pull requests, identifying vulnerabilities, and verifying secret sanitization.

#### Step 1: The Domain Skill (`config/skills/security-auditor/SKILL.md`)
```markdown
---
name: security-auditor
description: Use when conducting security audits, code reviews, and dependency checks.
---

# Security Auditor

## Guidelines & Rules
1. Audit for OWASP Top 10 vulnerabilities (Injection, Broken Auth, SSRF, XSS).
2. Scan for hardcoded secrets, unencrypted tokens, and insecure environment defaults.
3. Check package manifests (`package.json`, `requirements.txt`) for outdated or high-severity CVEs.
4. Every finding must include: Severity (Critical/High/Medium/Low), Vulnerable Line, and Remediation Diff.
```

#### Step 2: Optimal Model Selection
* **Model**: `anthropic/claude-3.5-sonnet` or `deepseek/deepseek-r1` for rigorous vulnerability reasoning.

#### Step 3: Headless Execution Recipe
```bash
./dsh.sh run "Using the security-auditor skill, audit all modified files in git diff HEAD~1 and generate a security report in /workspaces/security_audit.md"
```

---

### 3. 🚀 The "DevOps & SRE" Persona

Specialized in Docker container lifecycle, health diagnostics, and CI/CD pipelines.

#### Step 1: The Domain Skill (`config/skills/devops-sre/SKILL.md`)
```markdown
---
name: devops-sre
description: Use when managing Docker services, debugging container failures, and optimizing deployments.
---

# DevOps & SRE Engineer

## Guidelines & Rules
1. Run `./dsh.sh doctor` and inspect container logs before suggesting infrastructure fixes.
2. Ensure all container changes maintain non-root execution and health checks.
3. Keep Docker layers minimal and multi-stage builds clean ($< 1\text{ MB}$ writable layer).
```

#### Step 2: Headless Execution Recipe
```bash
./dsh.sh run "Using the devops-sre skill, inspect the current docker compose status and verify all health checks"
```

---

## 🔄 Running Personas in Docker

To invoke any persona in your Docker stack:

1. Place your skill in `config/skills/<persona-name>/SKILL.md` (or in project `.agents/skills/<persona-name>/SKILL.md`).
2. Run via Web UI (select the skill) or via CLI:
   ```bash
   ./dsh.sh run "Using the <persona-name> skill, <your task prompt>"
   ```
3. Monitor the execution trace live in **Arize Phoenix** at `http://localhost:6006`.
