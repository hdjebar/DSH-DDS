# Contributing to DeepSeek Harness (DSH-DDS)

Thank you for your interest in contributing to DSH-DDS! This project is an enterprise-grade agent operating environment and multi-model persona matrix designed for reproducible, secure local agent execution.

---

## 🧭 Contribution Philosophy: 3-Stage Promotion Lifecycle

To prevent regressions, installer drift, or broken containers, all changes follow a strict **3-stage verification lifecycle**:

```text
[Stage 1: Sandbox Verification] ➔ [Stage 2: Local Git Files] ➔ [Stage 3: Remote origin/main]
     (installtest/)                (canonical repo tree)          (GitHub CI Pipeline)
```

1. **Stage 1 (Prototyping & Sandbox Testing)**: Test modifications, persona manifests, and scripts inside an isolated local installation (e.g. `./installtest/`).
2. **Stage 2 (Local Canonical Synchronization)**: Reflect verified changes back into the canonical repo root (`config/`, `install_dsh.sh`, `dsh.sh`, etc.). Run local test suites:
   ```bash
   node --test tests/*.test.mjs
   ```
3. **Stage 3 (Promotion & CI Verification)**: Commit and push clean diffs to git. Verify that the GitHub Actions CI pipeline passes 100% green.

---

## 🧪 Local Test Suite & Linting

Before opening a pull request or pushing commits:

### 1. Run Node.js Test Suite
```bash
node --test tests/*.test.mjs
```
* **CLI & YAML Parsers**: Option flags, values, quotes, and robust YAML parsing across manifests.
* **Secret Scrubber**: Regex redaction for frontier API keys and GitHub PAT tokens.
* **Installer Parity**: 100% byte-for-byte synchronization between `install_dsh.sh` and canonical files.
* **Zero Trust RBAC & Confinement**: Enforces explicit persona access matrices, privilege escalation blocks, and GRC audit logs.
* **Build-Time Immutability**: Asserts build-time compilation of compatibility shims and zero dynamic runtime patching in `entrypoint.sh`.
* **Declarative Workflows & ACM**: Asserts zero executables in persona packages and validates step pipelines and conditional case management.
* **Skill Catalog Integrity**: Validates domain rules and schemas across all domain skills.

### 2. Shell & Dockerfile Linting
```bash
# Shell script validation
bash -n dsh.sh install_dsh.sh reset.sh
sh -n docker/entrypoint.sh

# Dockerfile linting (if hadolint is installed)
hadolint Dockerfile
```

### 3. Docker Compose Verification
```bash
# Verify base stack
docker compose config --quiet

# Verify hardened sandbox stack
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml config --quiet
```

---

## 🔒 Security & Safe Coding Guidelines

* **Never commit secrets**: Do not commit `.env`, API keys, or personal access tokens. Git pre-receive hooks and CI run Gitleaks checks.
* **Hermetic and Digest-Pinned Dependencies**: All container base images in `Dockerfile` must pin exact `sha256` digests, not floating tags.
* **Air-Gapped MCP & Personas**: New MCP servers must be capable of running offline (`--network none`) without external cloud phoning.

---

## 📜 Pull Request Process

1. Fork the repository and create a feature branch (`feature/my-enhancement` or `fix/issue-description`).
2. Ensure all tests pass (`node --test tests/*.test.mjs`).
3. Commit with concise, conventional commit messages (`feat: ...`, `fix: ...`, `docs: ...`).
4. Submit a Pull Request targeting `main`. GitHub Actions will automatically run the CI and Supply-Chain Hardening pipeline.
