# Changelog

All notable changes to the **DeepSeek Harness (DSH-DDS)** project are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.2.0] - 2026-09-02

### Added
* **AIDA Documentation Overhaul**: Reorganized `README.md` to elevate Quick Start above the fold, added audience statements, clear prerequisites, explicit verification criteria with `./dsh.sh doctor`, and next-step guides.
* **Diátaxis Documentation Index**: Grouped all 9 guide documents in `docs/` by audience (Getting Started, Daily Operations, Architecture & Reference, Theory).
* **CLI Profile Bundle Alignment**: Configured `@deepseek-ai/dsh-terminal` in `config/profiles/cli/package.json`.
* **CI Hardening**: Updated CI pipeline to Node.js 24 LTS and added `npm audit` dependency vulnerability scanning.
* **Dependabot Scope**: Added watching for `/config/profiles/cli`.
* **New Developer Documentation**: Added `CONTRIBUTING.md` documenting the 3-stage promotion lifecycle and local test workflows.

### Fixed
* **Persona YAML Validation (H-03)**: Dropped conflicting in-patch plugin array generation, resolving YAML parse errors across all 7 shipped personas.
* **Session ID Traversal Safety (L-19)**: Wired `validateSessionId` to safely permit dots in session filenames while strictly preventing directory traversal attacks (`..`).
* **Fail-Closed Phoenix Authentication (M-11)**: Replaced committed static fallback secrets with fail-closed authentication logic that requires user-supplied `PHOENIX_SECRET` when `PHOENIX_ENABLE_AUTH=true`.
* **Installer Error Propagation (M-05)**: Added strict error handling to `install_dsh.sh` so curl download failures abort installation immediately.
* **Secret Scrubber Bounds (M-08)**: Broadened regex matching for Google AI Studio keys and GitHub fine-grained PATs to minimum length bounds (`{35,}` and `{82,}`).
* **Workflow Key Lookup Exit Code (L-18)**: Ensured non-existent workflow keys exit with code 1 instead of silently exiting 0.
* **Documentation Accuracy (L-13, L-15)**: Aligned diagnostic suite count to 9 across all documentation, and clarified local cache vs OTel provider registration in model synchronization.

---

## [1.1.0] - 2026-09-02

### Added
* **Automated Audit Dossier Remediation**: Systematically resolved 22 findings across installer parity, persona distillation, container sandbox mounts, and diagnostics.
* **Pre-Configured SQLite MCP**: Registered `mcp-server-sqlite` in web profile and turnkey installer heredoc for tabular and database analysis.
* **Dynamic Parity Test Suite**: Added filesystem scanning in `tests/installer_parity.test.mjs` ensuring all canonical personas, skills, and templates are provisioned.
* **Safe Reset Ergonomics**: Separated soft reset (cache clearing, chat histories preserved) from destructive `--hard` reset.

---

## [1.0.0] - 2026-09-01

### Added
* **Initial Release**: Dual-container Docker topology pairing DeepSeek Harness with Arize Phoenix OpenTelemetry observability.
* **Native Gemini Thought Signature Bridge**: Fixed multi-turn tool-calling HTTP 400 errors with Google AI Studio.
* **Dynamic Model Synchronization**: Auto-sync for OpenRouter (420+ models) and Google Gemini (29+ models).
* **Hardened Sandbox Mode**: Read-only root filesystem, dropped capabilities, zero-egress network isolation.
