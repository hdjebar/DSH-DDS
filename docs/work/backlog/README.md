# 💡 Backlog & Ideation Workspace

Welcome to the **Backlog & Ideation** workspace. This directory is the creative sandbox for emerging concepts, architectural spikes, feature proposals, and exploratory thinking before they are formally scheduled into the sprint backlog (`todo/`).

---

## 📂 Subfolder Structure

* **`ideation/`**: Brainstorming briefs, architecture RFCs, thought experiments, and technology feasibility spikes.
* **Proposals & Unscheduled Epics**: Features awaiting prioritization, user feedback, or foundational prerequisite milestones.

---

## 🔄 Lifecycle Transition: Ideation → To Do

An idea graduates from `backlog/ideation/` to `todo/` when:
1. **Clear Problem Statement**: The concrete architectural need or developer friction is articulated.
2. **Technical Feasibility**: Core libraries, schemas, or container constraints are vetted.
3. **Security Invariant Assessment**: Evaluated against Landlock LSM, non-root execution (UID 1000), and Zero Trust RBAC.
4. **Actionable Scope**: Formatted into an Epic with measurable acceptance criteria.

---

## 📌 Current Ideation Items

| Title | Focus Area | Status | Document Link |
| :--- | :--- | :---: | :--- |
| **External Repo Assistant (Host/IDE Tier)** | Developer Tooling & DevEx | 💡 Brainstorming / Ready for Epic | [`ideation/brainstorm-repo-intelligence-assistant.md`](ideation/brainstorm-repo-intelligence-assistant.md) |
| **SOTA Research: External Repo Assistant** | System Architecture & AI-SWE | 🔬 SOTA Research Complete | [`ideation/sota-research-external-repo-assistant.md`](ideation/sota-research-external-repo-assistant.md) |
| **Multi-Tenancy Workspace Partitions** | Platform & Isolation | 🔬 Preliminary Discovery | Proposed |
| **eBPF Syscall Auditing** | Kernel Observability | 🔬 Technology Spike | Proposed |
