# 📐 Archify Architecture & Workflow Visualizations

Interactive, verifiable system architecture, workflow, and sequence diagrams for **DeepSeek Harness (DSH-DDS)** compiled deterministically using **[Archify](https://github.com/tt-a1i/archify)** (`@tt-a1i/archify-dsh`).

All diagrams in this directory are authored as typed JSON Intermediate Representations (IR), validated against strict schemas, and rendered to self-contained, publication-ready HTML/SVG artifacts featuring:
* 🌓 **Dark / Light mode** toggling with persistent visual presets
* 🔍 **Pan, zoom, search, and focus** modes for interactive inspection
* 🎬 **Story chapters** and guided walkthroughs
* 📦 **Truthful export** to PNG, SVG, WebM, and canonical 1200×630 Share Cards
* 🛡️ **Showcase quality certification** (9/9 artifact checks passed, 0 composition errors, 0 warnings)

---

## 🗺️ Interactive Diagram Index

| Diagram Type | Title & Artifact | Specification (IR) | Focus & Highlights |
| :--- | :--- | :--- | :--- |
| **`architecture`** | **[System Runtime Architecture](system-runtime.architecture.html)** | [`system-runtime.architecture.json`](system-runtime.architecture.json) | Non-root container sandbox (UID 1000), `@dsh-dds/core` Gateway, in-line PEP, BYOK Vault, Envoy egress proxy (ADR 0007), and local Arize Phoenix trace storage. |
| **`workflow`** | **[Zero-Trust PEP & RBAC Pipeline](security-pipeline.workflow.html)** | [`security-pipeline.workflow.json`](security-pipeline.workflow.json) | Real-time tool interception, canonical path resolution, symlink traversal detection (F-02), fail-closed quarantine traps, and immutable GRC audit logging. |
| **`workflow`** | **[Declarative Workflow & Loop Trap](declarative-workflow.workflow.html)** | [`declarative-workflow.workflow.json`](declarative-workflow.workflow.json) | Deterministic step hashing, Invariant 7 loop trap ring buffer (`LOOP_DETECTED`), ACM approval gate (`./dsh.sh approve`), and 15 typed capability adapters. |
| **`sequence`** | **[Agent Execution & OTLP Telemetry](agent-trace.sequence.html)** | [`agent-trace.sequence.json`](agent-trace.sequence.json) | User request lifecycle, AES-256-GCM BYOK key decryption, Gemini thought signature preservation, governed tool dispatch, and local Phoenix OTLP waterfall. |

---

## 🏛️ Diagram 1: System Runtime Architecture & Isolation

**Interactive Artifact:** [`system-runtime.architecture.html`](system-runtime.architecture.html)  
**JSON Specification:** [`system-runtime.architecture.json`](system-runtime.architecture.json)

```mermaid
flowchart TD
    subgraph Host ["💻 Host Environment (127.0.0.1)"]
        BROWSER["🌐 User Browser\n(Web UI :3080 / Phoenix :6006)"]
        VOL_CFG["📁 ./config (Mounted to /etc/dsh :ro)"]
        VOL_STATE["📁 ./config/state (Mounted to /var/lib/dsh :rw)"]
    end

    subgraph DSH_Sandbox ["🐳 DSH Container (UID 1000:1000, cap_drop: ALL)"]
        GW["🛡️ WebServer Gateway\n(@dsh-dds/core Origin Normalizer)"]
        KERNEL["⚡ DSH Microkernel\n(Cordis IoC Engine)"]
        VAULT["🔐 BYOK Vault\n(AES-256-GCM Keystore)"]
        PEP["🛡️ In-Line PEP Interceptor\n(Dynamic Tool & Path RBAC)"]
        ENVOY["🔒 Envoy Egress Proxy\n(v1.31 Loopback :10000 | ADR 0007)"]
        MCPS["🔌 MCP Tool Suite\n(Fetch, SQLite, GitHub, Context7)"]
        OTEL["📡 OTel Exporter\n(TraceContext Client)"]
    end

    subgraph Phoenix_Sandbox ["📊 Phoenix Container (UID 1000, 127.0.0.1:6006)"]
        PHOENIX["🔥 Arize Phoenix Engine\n(100% Local SQLite DB)"]
    end

    subgraph Cloud ["☁️ External LLM Providers"]
        LLM["🧠 Model Gateways\n(Google Gemini & OpenRouter)"]
    end

    BROWSER -->|HTTP :3080| GW
    GW --> KERNEL
    KERNEL -->|resolve keys| VAULT
    KERNEL -->|tool exec| PEP
    PEP -->|sandboxed tools| MCPS
    PEP -->|allowed egress| ENVOY
    ENVOY -->|mTLS / API| LLM
    KERNEL -->|spans| OTEL
    OTEL -->|OTLP :6006| PHOENIX
    BROWSER -->|Trace UI :6006| PHOENIX
```

---

## 🛡️ Diagram 2: Zero-Trust PEP & Dynamic RBAC Pipeline

**Interactive Artifact:** [`security-pipeline.workflow.html`](security-pipeline.workflow.html)  
**JSON Specification:** [`security-pipeline.workflow.json`](security-pipeline.workflow.json)

```mermaid
flowchart TD
    START(["Tool Request (Action + Params)"]) --> PEP["PEP Interceptor\n(In-Line Cordis Hook)"]
    PEP --> RBAC["RBAC Policy Matrix\n(Persona Read/Write Allowlists)"]
    RBAC --> BOUNDARY{"Path Boundary &\nSymlink Escape Check?"}

    BOUNDARY -->|Contained & Allowed| SANDBOX["Sandbox Dispatch\n(UID 1000, cap_drop: ALL)"]
    BOUNDARY -->|Escape or Unlisted| DENIED["Access Denied\n(RBAC_ACTION_REJECTED)"]

    DENIED --> SOC["Quarantine Trap\n(Halt Step & Alert SOC)"]
    SANDBOX --> RESULT(["Sanitized Execution Result"])
    SANDBOX --> AUDIT[("GRC Audit Ledger\naudit_grc.jsonl")]
    AUDIT --> PHOENIX["Phoenix Tracer\n(128-bit OTel Waterfall)"]
```

---

## 🔄 Diagram 3: Declarative Workflow & Invariant 7 Loop Trap

**Interactive Artifact:** [`declarative-workflow.workflow.html`](declarative-workflow.workflow.html)  
**JSON Specification:** [`declarative-workflow.workflow.json`](declarative-workflow.workflow.json)

```mermaid
flowchart TD
    STEP(["Workflow Step (Recipe)"]) --> HASH["Compute Step Signature\n(SHA-256 Hash Ring)"]
    HASH --> TRAP{"Invariant 7 Ring Buffer\n(3 Identical Repeats?)"}

    TRAP -->|Yes: Loop Detected| HALT["Loop Trap Triggered\n(LOOP_DETECTED Abort)"]
    TRAP -->|No: Clean Step| GATE{"ACM Approval Gate\n(High-Risk Action?)"}

    GATE -->|Requires Approval| SUSPEND["Suspend & Checkpoint\n(Wait for Ed25519 Signature)"]
    SUSPEND -->|./dsh.sh approve <id>| RESUME["Resume Workflow\n(Cryptographic Verification)"]
    GATE -->|Autonomous Step| ADAPTER["Capability Adapter\n(15 Typed Adapters)"]
    RESUME --> ADAPTER

    ADAPTER --> CKPT[("Atomic State Checkpoint\n.dsh_step_checkpoint.json")]
    CKPT --> PHX["Phoenix Telemetry\n(Parent-Child Span Waterfall)"]
    ADAPTER --> ADVANCE(["Step Complete & Advance State"])
```

---

## ⚡ Diagram 4: Agent Execution & OTLP Telemetry Sequence

**Interactive Artifact:** [`agent-trace.sequence.html`](agent-trace.sequence.html)  
**JSON Specification:** [`agent-trace.sequence.json`](agent-trace.sequence.json)

```mermaid
sequenceDiagram
    autonumber
    actor User as User Browser / CLI
    participant Gateway as WebServer Gateway
    participant Kernel as Cordis Microkernel
    participant Vault as BYOK Vault (AES-256)
    participant LLM as LLM Bridge (Gemini)
    participant PEP as In-Line PEP
    participant Phoenix as Arize Phoenix (:6006)

    User->>Gateway: POST /api/chat (Session Token)
    Gateway->>Kernel: Session Dispatch (User Partition)
    Kernel->>Vault: Retrieve Decrypted Key
    Vault-->>Kernel: API Credential (AES-256-GCM)
    Kernel->>LLM: Prompt + Thought Signature
    LLM-->>Kernel: tool_call (mcp-fetch)
    Kernel->>PEP: Intercept & Verify RBAC
    PEP-->>Kernel: Allow Execution (In-Boundary)
    Kernel->>LLM: Synthesize Findings
    LLM-->>Kernel: Final Agent Response
    Kernel-)Phoenix: Export OTLP Spans (:6006)
    Phoenix-->>Kernel: 200 OTLP Acknowledged
    Kernel-->>Gateway: Stream Sanitized Response
    Gateway-->>User: Complete Answer Rendered
```

---

## 🛠️ CLI & Build Commands

Re-compile or validate all diagrams anytime using the project scripts:

```bash
# Build and deliver all diagrams with showcase validation:
npm run diagrams:build

# Validate an individual diagram specification:
npm run archify -- validate architecture docs/diagrams/system-runtime.architecture.json --quality showcase

# Launch local interactive preview:
npm run archify -- preview architecture docs/diagrams/system-runtime.architecture.json
```
