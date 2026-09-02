# Development & Testing Workflow

Always adhere to the following 3-stage lifecycle for all improvements and bugfixes:

1. **Sandbox Prototyping & Testing (`installtest/`)**:
   - Test, experiment, and validate all changes in `installtest/`.
   - Verify Docker containers, scripts, and runtime health using `./dsh.sh doctor` or targeted test commands.

2. **Synchronize Canonical Local Repository**:
   - Port all verified fixes, scripts, and configurations to the canonical root files (e.g., `install_dsh.sh`, `Dockerfile`, `docker-compose.yml`, `config/`, `docs/`).
   - Run automated tests (`node --test tests/installer_parity.test.mjs`) to ensure installer parity and consistency.

3. **Push to Remote (`origin/main`)**:
   - Verify that `installtest/` and local credential files (`.env`) remain excluded.
   - Commit clean, descriptive changes and push to `origin/main`.
