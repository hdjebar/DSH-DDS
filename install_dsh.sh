#!/usr/bin/env bash
# Ultimate Single-File DeepSeek Harness Deployment Script (Automated .env Reader)
set -euo pipefail

FORCE=false
for arg in "$@"; do
  if [ "$arg" = "--force" ] || [ "$arg" = "-f" ]; then
    FORCE=true
  fi
done

write_file_safe() {
  local target="$1"
  if [ -f "$target" ] && [ "$FORCE" != true ]; then
    echo "ℹ️  Preserving existing $target (use --force to overwrite)"
    return 1
  fi
  mkdir -p "$(dirname "$target")"
  return 0
}

generate_secret() {
  local secret=''
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 32 2>/dev/null || true)"
  fi
  if [ "${#secret}" -ne 64 ] && command -v node >/dev/null 2>&1; then
    secret="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" 2>/dev/null || true)"
  fi
  if [ "${#secret}" -ne 64 ] && [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    secret="$(od -An -N32 -tx1 /dev/urandom 2>/dev/null | tr -d '[:space:]' || true)"
  fi
  if [ "${#secret}" -ne 64 ] || ! [[ "$secret" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo '❌ Unable to generate a cryptographically secure secret.' >&2
    return 1
  fi
  printf '%s' "$secret"
}

# 1. Target Directory & Path Setup
export DSH_INSTALL="${DSH_INSTALL:-$(pwd)}"
echo "🚀 Setting up DeepSeek Harness at: $DSH_INSTALL"

mkdir -p "$DSH_INSTALL/config/profiles/web" \
         "$DSH_INSTALL/config/sessions" \
         "$DSH_INSTALL/config/audit" \
         "$DSH_INSTALL/config/audit-checkpoints" \
         "$DSH_INSTALL/config/users" \
         "$DSH_INSTALL/config/storages" \
         "$DSH_INSTALL/config/patch" \
         "$DSH_INSTALL/config/phoenix" \
         "$DSH_INSTALL/config/cache" \
         "$DSH_INSTALL/workspaces/cases" \
         "$DSH_INSTALL/workspaces/users" \
         "$DSH_INSTALL/workspaces/shared" \
         "$DSH_INSTALL/workspaces/artifacts" \
         "$DSH_INSTALL/packages/dsh-dds-core" \
         "$DSH_INSTALL/services/isolated-executor"

# Workspace content is shared with the isolated executor through group DSH_GID.
# Vaults, sessions, audit data, and other application state are intentionally excluded.
chmod 0770 "$DSH_INSTALL/workspaces/cases" "$DSH_INSTALL/workspaces/users"
chmod 0750 "$DSH_INSTALL/workspaces/shared"

# 2. Strict & Safe Environment Variable Loader
load_env_safely() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading/trailing whitespace
    line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    case "$line" in
      \#*|"") continue ;;
    esac
    # Validate strictly alphanumeric KEY name
    if echo "$line" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*='; then
      local key="${line%%=*}"
      local val="${line#*=}"
      # Strip surrounding quotes safely
      if [[ "$val" =~ ^\"(.*)\"$ ]]; then
        val="${BASH_REMATCH[1]}"
      elif [[ "$val" =~ ^\'(.*)\'$ ]]; then
        val="${BASH_REMATCH[1]}"
      fi
      export "$key=$val"
    fi
  done < "$env_file"
}

if [ -f "$DSH_INSTALL/.env" ]; then
  chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
  echo "📝 Loading environment variables from $DSH_INSTALL/.env..."
  load_env_safely "$DSH_INSTALL/.env"
elif [ -f ".env" ]; then
  echo "📝 Copying local .env to $DSH_INSTALL/.env and loading variables..."
  cp .env "$DSH_INSTALL/.env"
  chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
  load_env_safely "$DSH_INSTALL/.env"
else
  echo "⚙️  No .env file found. Setting up new configuration..."
  if [ -t 0 ]; then
    echo "🔑 Please enter your API keys (hidden input, or press Enter to skip and populate later):"
    read -srp "  • Google Gemini API Key [GEMINI_API_KEY]: " input_gemini
    echo ""
    read -srp "  • OpenRouter API Key [OPENROUTER_API_KEY]: " input_openrouter
    echo ""
    read -srp "  • GitHub Personal Access Token [GITHUB_PERSONAL_ACCESS_TOKEN]: " input_github
    echo ""
    read -rp "  • DSH Web Port [default 3080]: " input_port
    
    AUTO_APPROVAL_SECRET="$(generate_secret)"
    VAULT_MASTER_KEY="$(generate_secret)"
    RESTART_CSRF_TOKEN="$(generate_secret)"
    AUDIT_INTEGRITY_KEY="$(generate_secret)"
    EXECUTOR_CAPABILITY_KEY="$(generate_secret)"
    AUDIT_WRITER_TOKEN="$(generate_secret)"
    PHOENIX_SECRET="$(generate_secret)"
    PHOENIX_ADMIN_SECRET="dsh0_$(generate_secret)"
    PHOENIX_INITIAL_PASSWORD="dsh0_$(generate_secret)"
    cat << EOF > "$DSH_INSTALL/.env"
# DeepSeek Harness + Arize Phoenix Environment Configuration
DSH_PORT=${input_port:-3080}
GEMINI_API_KEY=${input_gemini:-}
OPENROUTER_API_KEY=${input_openrouter:-}
GITHUB_PERSONAL_ACCESS_TOKEN=${input_github:-}
PHOENIX_ENABLE_AUTH=true
PHOENIX_SECRET=${PHOENIX_SECRET}
PHOENIX_ADMIN_SECRET=${PHOENIX_ADMIN_SECRET}
PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD=${PHOENIX_INITIAL_PASSWORD}
PHOENIX_API_KEY=${PHOENIX_ADMIN_SECRET}
DSH_APPROVAL_SECRET=${AUTO_APPROVAL_SECRET}
DSH_VAULT_MASTER_KEY=${VAULT_MASTER_KEY}
DSH_RESTART_CSRF_TOKEN=${RESTART_CSRF_TOKEN}
DSH_AUDIT_INTEGRITY_KEY=${AUDIT_INTEGRITY_KEY}
DSH_AUDIT_WRITER_TOKEN=${AUDIT_WRITER_TOKEN}
DSH_EXECUTOR_CAPABILITY_KEY=${EXECUTOR_CAPABILITY_KEY}
EOF
    chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
    echo "✅ Generated $DSH_INSTALL/.env (mode 0600)"
    load_env_safely "$DSH_INSTALL/.env"
  else
    AUTO_APPROVAL_SECRET="$(generate_secret)"
    VAULT_MASTER_KEY="$(generate_secret)"
    RESTART_CSRF_TOKEN="$(generate_secret)"
    AUDIT_INTEGRITY_KEY="$(generate_secret)"
    EXECUTOR_CAPABILITY_KEY="$(generate_secret)"
    AUDIT_WRITER_TOKEN="$(generate_secret)"
    PHOENIX_SECRET="$(generate_secret)"
    PHOENIX_ADMIN_SECRET="dsh0_$(generate_secret)"
    PHOENIX_INITIAL_PASSWORD="dsh0_$(generate_secret)"
    cat << EOF > "$DSH_INSTALL/.env"
# DeepSeek Harness + Arize Phoenix Environment Configuration
DSH_PORT=3080
GEMINI_API_KEY=
OPENROUTER_API_KEY=
GITHUB_PERSONAL_ACCESS_TOKEN=
PHOENIX_ENABLE_AUTH=true
PHOENIX_SECRET=${PHOENIX_SECRET}
PHOENIX_ADMIN_SECRET=${PHOENIX_ADMIN_SECRET}
PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD=${PHOENIX_INITIAL_PASSWORD}
PHOENIX_API_KEY=${PHOENIX_ADMIN_SECRET}
DSH_APPROVAL_SECRET=${AUTO_APPROVAL_SECRET}
DSH_VAULT_MASTER_KEY=${VAULT_MASTER_KEY}
DSH_RESTART_CSRF_TOKEN=${RESTART_CSRF_TOKEN}
DSH_AUDIT_INTEGRITY_KEY=${AUDIT_INTEGRITY_KEY}
DSH_AUDIT_WRITER_TOKEN=${AUDIT_WRITER_TOKEN}
DSH_EXECUTOR_CAPABILITY_KEY=${EXECUTOR_CAPABILITY_KEY}
EOF
    chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
    echo "📝 Generated starter $DSH_INSTALL/.env template (mode 0600). You can populate keys anytime in .env."
    load_env_safely "$DSH_INSTALL/.env"
  fi
fi

# Upgrade-safe secret bootstrap: existing installations may predate the isolated
# executor, external audit writer, and authenticated Phoenix gateway. Never reuse
# one trust-domain secret for another.
append_generated_env_secret() {
  local variable_name="$1"
  local prefix="${2:-}"
  local current_value="${!variable_name:-}"
  if [ -n "$current_value" ]; then return 0; fi
  local generated_value
  generated_value="${prefix}$(generate_secret)"
  printf '\n%s=%s\n' "$variable_name" "$generated_value" >> "$DSH_INSTALL/.env"
  export "$variable_name=$generated_value"
}

append_generated_env_secret DSH_RESTART_CSRF_TOKEN
append_generated_env_secret DSH_AUDIT_INTEGRITY_KEY
append_generated_env_secret DSH_AUDIT_WRITER_TOKEN
append_generated_env_secret DSH_EXECUTOR_CAPABILITY_KEY
append_generated_env_secret PHOENIX_SECRET
append_generated_env_secret PHOENIX_ADMIN_SECRET 'dsh0_'
append_generated_env_secret PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD 'dsh0_'
if [ -z "${PHOENIX_API_KEY:-}" ]; then
  printf '\nPHOENIX_API_KEY=%s\n' "$PHOENIX_ADMIN_SECRET" >> "$DSH_INSTALL/.env"
  export PHOENIX_API_KEY="$PHOENIX_ADMIN_SECRET"
fi
if [ -z "${PHOENIX_ENABLE_AUTH:-}" ]; then
  printf '\nPHOENIX_ENABLE_AUTH=true\n' >> "$DSH_INSTALL/.env"
  export PHOENIX_ENABLE_AUTH=true
elif [ "$PHOENIX_ENABLE_AUTH" != 'true' ] && [ "$PHOENIX_ENABLE_AUTH" != '1' ]; then
  echo '❌ Phoenix authentication must be enabled. Set PHOENIX_ENABLE_AUTH=true in .env.' >&2
  exit 1
fi
chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true

DSH_REF="${DSH_REF:-v2.0.0}"
DSH_REPO_URL="${DSH_REPO_URL:-https://raw.githubusercontent.com/hdjebar/DSH-DDS}"
GITHUB_RAW="$DSH_REPO_URL/$DSH_REF"

# Validate remote ref accessibility when downloading from remote (PR-004 & Supply Chain Hardening)
validate_remote_ref() {
  if [ -z "${DSH_SOURCE_DIR:-}" ] || [ "${DSH_CHECK_REMOTE_REF:-0}" = "1" ]; then
    if ! curl -fsSL -I "${DSH_REPO_URL}/${DSH_REF}/Dockerfile" >/dev/null 2>&1; then
      if [ "${DSH_ALLOW_REF_FALLBACK:-0}" = "1" ]; then
        if [ "$DSH_REF" != "main" ] && curl -fsSL -I "${DSH_REPO_URL}/main/Dockerfile" >/dev/null 2>&1; then
          echo "⚠️ Security Warning: DSH_REF '$DSH_REF' not found on remote. Falling back to 'main' (DSH_ALLOW_REF_FALLBACK=1)..."
          DSH_REF="main"
          GITHUB_RAW="${DSH_REPO_URL}/main"
          return 0
        fi
      fi
      echo "❌ Error: Could not resolve git ref '$DSH_REF' from remote repository." >&2
      echo "To permit falling back to 'main', rerun with DSH_ALLOW_REF_FALLBACK=1." >&2
      exit 1
    fi
  fi
}
validate_remote_ref

# Initialize isolated atomic staging workspace
STAGE_DIR="$(mktemp -d "${DSH_INSTALL}.staging.XXXXXX" 2>/dev/null || mktemp -d "/tmp/dsh-staging.XXXXXX")"
cleanup_staging() {
  if [ -n "${STAGE_DIR:-}" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
}
trap cleanup_staging EXIT INT TERM

# Verify the release archive against the SHA256SUMS asset published for this ref.
# Fails closed: an unverifiable archive is refused unless the operator explicitly
# opts out with DSH_ALLOW_UNVERIFIED_ARCHIVE=1.
verify_archive_checksum() {
  local archive_path="$1"
  local sums_url="https://github.com/hdjebar/DSH-DDS/releases/download/${DSH_REF}/SHA256SUMS"

  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    if [ "${DSH_ALLOW_UNVERIFIED_ARCHIVE:-0}" = "1" ]; then
      echo "⚠️  Security Warning: no sha256 tool available; skipping archive verification (DSH_ALLOW_UNVERIFIED_ARCHIVE=1)." >&2
      return 0
    fi
    echo "❌ Error: neither sha256sum nor shasum is available to verify the release archive." >&2
    echo "   Install one, or rerun with DSH_ALLOW_UNVERIFIED_ARCHIVE=1 to accept an unverified download." >&2
    exit 1
  fi

  if ! curl -fsSL "$sums_url" -o "$STAGE_DIR/SHA256SUMS" 2>/dev/null; then
    if [ "${DSH_ALLOW_UNVERIFIED_ARCHIVE:-0}" = "1" ]; then
      echo "⚠️  Security Warning: no SHA256SUMS published for ref '$DSH_REF'; installing unverified (DSH_ALLOW_UNVERIFIED_ARCHIVE=1)." >&2
      return 0
    fi
    echo "❌ Error: no SHA256SUMS asset published for ref '$DSH_REF'; refusing to install an unverified archive." >&2
    echo "   Rerun with DSH_ALLOW_UNVERIFIED_ARCHIVE=1 to accept the download without integrity verification." >&2
    exit 1
  fi

  local expected
  expected="$(awk '$2 ~ /(^|\/)archive\.tar\.gz$/ { print $1; exit }' "$STAGE_DIR/SHA256SUMS")"
  if [ -z "$expected" ]; then
    echo "❌ Error: SHA256SUMS for ref '$DSH_REF' contains no entry for archive.tar.gz." >&2
    exit 1
  fi

  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$archive_path" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
  fi

  if [ "$expected" != "$actual" ]; then
    echo "❌ Error: release archive checksum mismatch for ref '$DSH_REF'." >&2
    echo "   expected: $expected" >&2
    echo "   actual:   $actual" >&2
    exit 1
  fi
  echo "🔐 Verified release archive checksum for $DSH_REF."
}

fetch_or_copy_file() {
  local rel_path="$1"
  local final_dest="$DSH_INSTALL/$rel_path"
  if [ -f "$final_dest" ] && [ "$FORCE" != true ]; then
    return 0
  fi
  local stage_dest="$STAGE_DIR/$rel_path"
  mkdir -p "$(dirname "$stage_dest")"
  local local_source="${DSH_SOURCE_DIR:-.}/$rel_path"
  if [ -f "$local_source" ]; then
    cp "$local_source" "$stage_dest"
  elif [ -f "$stage_dest" ]; then
    return 0
  else
    # Atomic archive retrieval to prevent TOCTOU and supply chain inconsistency (Finding 3)
    if [ ! -f "$STAGE_DIR/.archive_attempted" ]; then
      touch "$STAGE_DIR/.archive_attempted"
      echo "📦 Fetching atomic release archive ($DSH_REF) to prevent TOCTOU supply chain risks..."
      local archive_url="https://github.com/hdjebar/DSH-DDS/archive/refs/tags/${DSH_REF}.tar.gz"
      if ! curl -fsSL "$archive_url" -o "$STAGE_DIR/archive.tar.gz" 2>/dev/null; then
        archive_url="https://github.com/hdjebar/DSH-DDS/archive/refs/heads/${DSH_REF}.tar.gz"
        curl -fsSL "$archive_url" -o "$STAGE_DIR/archive.tar.gz" 2>/dev/null || true
      fi
      if [ -f "$STAGE_DIR/archive.tar.gz" ] && [ -s "$STAGE_DIR/archive.tar.gz" ]; then
        verify_archive_checksum "$STAGE_DIR/archive.tar.gz"
        if ! tar -xzf "$STAGE_DIR/archive.tar.gz" --strip-components=1 -C "$STAGE_DIR"; then
          echo "❌ Error: Failed to extract release archive for ref '$DSH_REF'." >&2
          exit 1
        fi
        rm -f "$STAGE_DIR/archive.tar.gz"
      fi
    fi
    if [ ! -f "$stage_dest" ]; then
      echo "⬇️  Downloading $rel_path from repository..."
      if ! curl -fsSL "$GITHUB_RAW/$rel_path" -o "$stage_dest"; then
        echo "❌ Error: Failed to download $rel_path from $GITHUB_RAW/$rel_path" >&2
        exit 1
      fi
    fi
  fi
}

# Provision essential runtime scripts, personas, templates, and CLI tools
echo "📦 Provisioning runtime engines, personas, and diagnostic tools..."
fetch_or_copy_file "config/sync_models.mjs"
fetch_or_copy_file "config/doctor.mjs"
fetch_or_copy_file "config/persona.mjs"

fetch_or_copy_file "config/declarative-orchestrator.mjs"
fetch_or_copy_file "config/outbound-security.mjs"
fetch_or_copy_file "config/audit-client.mjs"
fetch_or_copy_file "config/audit-writer-core.mjs"
fetch_or_copy_file "config/audit-writer.mjs"
fetch_or_copy_file "config/telemetry-gateway.mjs"
fetch_or_copy_file "config/audit-checkpoints/.gitkeep"
fetch_or_copy_file "config/rbac-policy.mjs"
fetch_or_copy_file "config/settings.default.yaml"
# Stage settings.yaml for clean installs (FR-016)
if [ ! -f "$DSH_INSTALL/config/settings.yaml" ]; then
  if [ -f "$STAGE_DIR/config/settings.default.yaml" ]; then
    cp "$STAGE_DIR/config/settings.default.yaml" "$STAGE_DIR/config/settings.yaml"
  elif [ -f "$DSH_INSTALL/config/settings.default.yaml" ]; then
    cp "$DSH_INSTALL/config/settings.default.yaml" "$STAGE_DIR/config/settings.yaml"
  fi
fi
fetch_or_copy_file "dsh.sh"
fetch_or_copy_file "reset.sh"
fetch_or_copy_file "docker-compose.sandbox.yml"
fetch_or_copy_file "docker-compose.dev.yml"
fetch_or_copy_file "docker/entrypoint.sh"
fetch_or_copy_file "services/isolated-executor/server.mjs"
fetch_or_copy_file "scripts/prepare_executor_workspaces.mjs"
fetch_or_copy_file "scripts/migrate_tenant_partitions.mjs"
fetch_or_copy_file "scripts/lib/tenant_partition_migration.mjs"
fetch_or_copy_file "config/schemas/tenant-partition-migration-v1.schema.json"

# Profiles
fetch_or_copy_file "packages/dsh-dds-core/package.json"
fetch_or_copy_file "packages/dsh-dds-core/index.js"
fetch_or_copy_file "packages/dsh-dds-core/gateway.js"
fetch_or_copy_file "packages/dsh-dds-core/model-catalog.js"
fetch_or_copy_file "packages/dsh-dds-core/localization.js"
fetch_or_copy_file "packages/dsh-dds-core/rbac-interceptor.js"
fetch_or_copy_file "packages/dsh-dds-core/llm-gateway.js"
fetch_or_copy_file "packages/dsh-dds-core/loader.mjs"
fetch_or_copy_file "packages/dsh-dds-core/loader-hooks.mjs"
fetch_or_copy_file "packages/dsh-dds-core/web-search.js"
fetch_or_copy_file "packages/dsh-dds-core/iam.js"
fetch_or_copy_file "packages/dsh-dds-core/user-partition.js"
fetch_or_copy_file "packages/dsh-dds-core/byok-vault.js"
fetch_or_copy_file "packages/dsh-dds-core/net-trust.js"
fetch_or_copy_file "packages/dsh-dds-core/execution-capability.js"
fetch_or_copy_file "packages/dsh-dds-core/isolated-shell-executor.js"
fetch_or_copy_file "config/profiles/web/pnpm-lock.yaml"
fetch_or_copy_file "config/profiles/web/pnpm-workspace.yaml"
fetch_or_copy_file "config/profiles/web/cordis.yml"
fetch_or_copy_file "config/profiles/cli/pnpm-lock.yaml"
fetch_or_copy_file "config/profiles/cli/package.json"
fetch_or_copy_file "config/profiles/cli/cordis.yml"
fetch_or_copy_file "config/profiles/headless/package.json"
fetch_or_copy_file "config/profiles/headless/cordis.yml"
fetch_or_copy_file "config/profiles/headless/cordis.patch.yml"
fetch_or_copy_file "config/profiles/headless/pnpm-workspace.yaml"

# Personas (all 7 domain packages - 100% Declarative Architecture)
fetch_or_copy_file "config/personas/sdmx-expert/persona.yaml"
fetch_or_copy_file "config/personas/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/personas/data-analyst/persona.yaml"
fetch_or_copy_file "config/personas/data-analyst/SKILL.md"
fetch_or_copy_file "config/personas/devops-sre/persona.yaml"
fetch_or_copy_file "config/personas/devops-sre/SKILL.md"
fetch_or_copy_file "config/personas/mlops-engineer/persona.yaml"
fetch_or_copy_file "config/personas/mlops-engineer/SKILL.md"
fetch_or_copy_file "config/personas/persona-creator/persona.yaml"
fetch_or_copy_file "config/personas/persona-creator/SKILL.md"
fetch_or_copy_file "config/personas/security-auditor/persona.yaml"
fetch_or_copy_file "config/personas/security-auditor/SKILL.md"
fetch_or_copy_file "config/personas/stats-engineer/persona.yaml"
fetch_or_copy_file "config/personas/stats-engineer/SKILL.md"

# Skills (all 7 domain skills)
fetch_or_copy_file "config/skills/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/skills/data-analyst/SKILL.md"
fetch_or_copy_file "config/skills/devops-sre/SKILL.md"
fetch_or_copy_file "config/skills/mlops-engineer/SKILL.md"
fetch_or_copy_file "config/skills/persona-creator/SKILL.md"
fetch_or_copy_file "config/skills/security-auditor/SKILL.md"
fetch_or_copy_file "config/skills/stats-engineer/SKILL.md"

# Templates
fetch_or_copy_file "config/templates/personas/base-template/persona.yaml"
fetch_or_copy_file "config/templates/personas/base-template/SKILL.md"
fetch_or_copy_file "config/templates/personas/sdmx-expert/persona.yaml"
fetch_or_copy_file "config/templates/personas/sdmx-expert/SKILL.md"
fetch_or_copy_file "config/templates/personas/data-analyst/persona.yaml"
fetch_or_copy_file "config/templates/personas/data-analyst/SKILL.md"
fetch_or_copy_file "config/templates/personas/devops-sre/persona.yaml"
fetch_or_copy_file "config/templates/personas/devops-sre/SKILL.md"
fetch_or_copy_file "config/templates/personas/persona-creator/persona.yaml"
fetch_or_copy_file "config/templates/personas/persona-creator/SKILL.md"
fetch_or_copy_file "config/templates/personas/security-auditor/persona.yaml"
fetch_or_copy_file "config/templates/personas/security-auditor/SKILL.md"

# Verify staged assets before promoting atomically (FR-016)
verify_and_promote_staged() {
  echo "🔍 Verifying staged installation integrity..."
  local required_staged=(
    "config/sync_models.mjs"
    "config/doctor.mjs"
    "config/persona.mjs"
    "config/declarative-orchestrator.mjs"
    "config/outbound-security.mjs"
    "config/audit-client.mjs"
    "config/audit-writer-core.mjs"
    "config/audit-writer.mjs"
    "config/telemetry-gateway.mjs"
    "config/audit-checkpoints/.gitkeep"
    "config/rbac-policy.mjs"
    "config/settings.default.yaml"
    "config/settings.yaml"
    "dsh.sh"
    "reset.sh"
    "docker-compose.sandbox.yml"
    "docker-compose.dev.yml"
    "docker/entrypoint.sh"
    "scripts/migrate_tenant_partitions.mjs"
    "scripts/lib/tenant_partition_migration.mjs"
    "config/schemas/tenant-partition-migration-v1.schema.json"
  )
  for f in "${required_staged[@]}"; do
    if [ ! -f "$DSH_INSTALL/$f" ] && [ ! -s "$STAGE_DIR/$f" ]; then
      echo "❌ Error: Staged file '$f' is missing or empty. Aborting installation." >&2
      exit 1
    fi
  done

  # Atomically promote staged files into DSH_INSTALL with rollback protection (FR-016)
  if [ -d "$STAGE_DIR" ]; then
    echo "🚚 Promoting verified assets into $DSH_INSTALL..."
    local backup_dir=""
    if [ -d "$DSH_INSTALL" ] && [ "$(ls -A "$DSH_INSTALL" 2>/dev/null)" ]; then
      backup_dir="$(mktemp -d "${DSH_INSTALL}.backup.XXXXXX" 2>/dev/null || mktemp -d "/tmp/dsh-install-backup.XXXXXX")"
      cp -a "$DSH_INSTALL/." "$backup_dir/" 2>/dev/null || true
    fi

    local promote_failed=0
    (
      cd "$STAGE_DIR"
      find . -type f | while read -r staged_file; do
        target_path="$DSH_INSTALL/${staged_file#./}"
        # Preserve existing user customizations unless force
        if [ -f "$target_path" ] && [ "${FORCE:-false}" != "true" ]; then
          case "$staged_file" in
            ./config/settings.yaml|./config/cordis.patch.yml)
              continue
              ;;
          esac
        fi
        mkdir -p "$(dirname "$target_path")"
        cp -p "$staged_file" "$target_path" || exit 1
      done
    ) || promote_failed=1

    if [ "$promote_failed" -ne 0 ]; then
      echo "❌ Error: Promotion failed! Rolling back..." >&2
      if [ -n "$backup_dir" ] && [ -d "$backup_dir" ]; then
        cp -a "$backup_dir/." "$DSH_INSTALL/" 2>/dev/null || true
        rm -rf "$backup_dir"
      fi
      exit 1
    fi

    if [ -n "$backup_dir" ] && [ -d "$backup_dir" ]; then
      rm -rf "$backup_dir"
    fi
    rm -rf "$STAGE_DIR"
    STAGE_DIR=""
  fi
}
verify_and_promote_staged

# Permissions
chmod +x "$DSH_INSTALL/dsh.sh" 2>/dev/null || true
chmod +x "$DSH_INSTALL/reset.sh" 2>/dev/null || true
chmod +x "$DSH_INSTALL/docker/entrypoint.sh" 2>/dev/null || true

# 3. Write Active Cordis Patch Configuration (Dual Gemini + OpenRouter Native Architecture)
if write_file_safe "$DSH_INSTALL/config/cordis.patch.yml"; then
cat << 'EOF' > "$DSH_INSTALL/config/cordis.patch.yml"
- id: llm-deepseek
  disabled: true
- id: web-search-deepseek
  disabled: true
- id: web
  config:
    searchProvider: modsearch
    defaultWorkspacePath: /workspaces
- id: find-dsh-plugin
  config:
    search_paths:
      - /workspaces
    exclude_patterns:
      - "**/node_modules/**"
      - "**/.git/**"
      - "**/.venv/**"
- id: better-sidebar
  config:
    layout: vscode-classic
    persistent_terminal: true
- id: model-sync
  config:
    auto_poll_on_startup: true
    sync_interval_hours: 12
    enable_quota_ui_widget: true
- id: mnemon
  config:
    enable_per_workspace_memory: true
    auto_index_project_briefs: true
- id: session-telemetry-otel
  config:
    mode: !!js process.env.DSH_TELEMETRY_MODE || 'FULL'
    shutdownTimeoutMillis: 3000
    exporter:
      url: !!js process.env.DSH_TELEMETRY_OTLP_URL || 'http://phoenix:6006/v1/traces'
      compression: none
      timeoutMillis: 2000
- id: llm-pi-ai
  config:
    providers:
      gemini:
        apiKeyEnv: GEMINI_API_KEY
        displayName: "Google AI Studio (Gemini)"
        api: openai-completions
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
        models:
          - id: "gemini-3.8-flash"
            name: "Google: Gemini 3.8 Flash"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
          - id: "gemini-3.7-flash"
            name: "Google: Gemini 3.7 Flash"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
          - id: "gemini-3.6-flash"
            name: "Google: Gemini 3.6 Flash"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
          - id: "gemini-3.5-flash"
            name: "Google: Gemini 3.5 Flash"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
          - id: "gemini-3.5-flash-lite"
            name: "Google: Gemini 3.5 Flash Lite"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
          - id: "gemini-3.1-pro-preview"
            name: "Google: Gemini 3.1 Pro Preview"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
          - id: "gemini-flash-latest"
            name: "Google: Gemini Flash (Auto-Updating)"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
          - id: "gemini-pro-latest"
            name: "Google: Gemini Pro (Auto-Updating)"
            contextWindow: 1048576
            maxTokens: 65536
            input: ["text", "image"]
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
        displayName: "OpenRouter"
        api: openai-completions
        baseURL: "https://openrouter.ai/api/v1"
        models:
          - id: "deepseek/deepseek-chat"
            name: "DeepSeek: DeepSeek V3"
            contextWindow: 163840
            maxTokens: 8192
          - id: "deepseek/deepseek-r1"
            name: "DeepSeek: DeepSeek R1"
            contextWindow: 64000
            maxTokens: 8192
          - id: "anthropic/claude-sonnet-5"
            name: "Anthropic: Claude Sonnet 5"
            contextWindow: 200000
            maxTokens: 8192
          - id: "anthropic/claude-opus-5"
            name: "Anthropic: Claude Opus 5"
            contextWindow: 200000
            maxTokens: 8192
          - id: "openai/gpt-6-astra"
            name: "OpenAI: GPT-6 Astra"
            contextWindow: 1050000
            maxTokens: 16384
          - id: "openai/gpt-5.6-luna"
            name: "OpenAI: GPT-5.6 Luna"
            contextWindow: 1050000
            maxTokens: 16384
          - id: "meta-llama/llama-3.3-70b-instruct"
            name: "Meta: Llama 3.3 70B Instruct"
            contextWindow: 131072
            maxTokens: 8192
          - id: "google/gemini-3.8-flash"
            name: "OpenRouter: Google Gemini 3.8 Flash"
            contextWindow: 1048576
            maxTokens: 65536
- id: agent-default-model
  config:
    provider: openrouter
    model: deepseek/deepseek-chat
EOF
fi

# 3. Write Web Profile Plugin Manifest (10 Pre-Packaged Plugins)
if write_file_safe "$DSH_INSTALL/config/profiles/web/package.json"; then
cat << 'EOF' > "$DSH_INSTALL/config/profiles/web/package.json"
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@liustack/modsearch": "^5.10.1",
    "deepseek-flow": "^0.4.0",
    "dsh-better-sidebar": "^0.18.0",
    "dsh-find-plugin": "^0.3.7",
    "dsh-mcp-market": "^0.1.2",
    "dsh-mcp-panel": "^0.6.7",
    "dsh-mnemon": "^0.5.4",
    "dsh-model-sync": "^0.1.6",
    "dsh-provider-model-configurator": "github:LiangYin233/dsh-provider-model-configurator#70f88112c7d92fadeb93e46f5dcb8b1f3ae6eba3",
    "dsh-session-reader": "^0.1.0",
    "dshmarket": "^1.44.0"
  },
  "dsh": {
    "profile": {
      "patchReload": "startup",
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@liustack/modsearch",
        "dshmarket",
        "dsh-find-plugin",
        "dsh-mcp-panel",
        "dsh-provider-model-configurator",
        "dsh-mnemon",
        "dsh-model-sync",
        "dsh-mcp-market",
        "dsh-session-reader",
        "deepseek-flow",
        "dsh-better-sidebar"
      ]
    }
  }
}
EOF

# 4. Write Web Profile MCP Configuration (Pinned MCP Servers)
cat << 'EOF' > "$DSH_INSTALL/config/profiles/web/cordis.patch.yml"
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
- id: webserver
  inject: [webStartup]
  config:
    host: 0.0.0.0
    port: !!js Number(process.env.PORT ?? 3080)
- id: settings
  config:
    path: /var/lib/dsh/storages/settings.yaml
- id: sub-model-access
  disabled: true
- id: bash-sandbox
  disabled: true
- insert:
    - id: dsh-dds-isolated-shell
      name: '@dsh-dds/core/isolated-shell-executor'
      config:
        socketPath: /run/dsh-executor/executor.sock
        cwd: /workspaces/cases
        timeoutMs: 60000
        maxTimeoutMs: 120000
        maxOutputBytes: 65536
- id: model-sync
  disabled: false
- insert:
    - id: dsh-dds-core
      name: '@dsh-dds/core'
      config:
        enableToolRbac: true
        modelSyncIntervalHours: 12
# --- dsh-mcp-market managed (auto-generated; do not edit) ---
- insert:
    - id: mcp-fetch
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: fetch
        transport: stdio
        command: mcp-server-webresearch
        args: []
- insert:
    - id: mcp-context7
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: context7
        transport: stdio
        command: context7-mcp
        args: []
- insert:
    - id: mcp-github
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: github
        transport: stdio
        command: github-mcp-server
        args:
          - stdio
- insert:
    - id: mcp-sqlite-db
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: sqlite-db
        transport: stdio
        command: mcp-server-sqlite
        args:
          - --db-path
          - /var/lib/dsh/storages/data.db
# --- end dsh-mcp-market managed ---
EOF
fi

# 5. Write Multi-Stage Dockerfile (pnpm builder + minimal runtime)
if write_file_safe "$DSH_INSTALL/Dockerfile"; then
cat << 'EOF' > "$DSH_INSTALL/Dockerfile"
# ── Stage 1: Multi-Stage Builder with pnpm ───────────────────────
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    build-essential \
    && npm install -g pnpm@11.25.0 \
    && rm -rf /var/lib/apt/lists/*

ENV HOME="/home/dsh"
WORKDIR /var/lib/dsh/profiles/web
COPY config/profiles/web/package.json config/profiles/web/pnpm-lock.yaml config/profiles/web/pnpm-workspace.yaml ./

RUN mkdir -p /home/dsh/.local/share/pnpm/store/v11 \
    && pnpm config set minimum-release-age 0 \
    && pnpm config set store-dir /home/dsh/.local/share/pnpm/store/v11 \
    && pnpm install --frozen-lockfile \
    && (pnpm approve-builds node-pty protobufjs sharp || true) \
    && pnpm prune --prod \
    && rm -rf /root/.cache /root/.npm

# ── Stage 2: Hardened Minimal Production Runtime ───────────────────
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runner

# Copy static Astral uv and uvx binaries for lightweight Python MCP execution
COPY --from=ghcr.io/astral-sh/uv:0.6.5@sha256:562193a4a9d398f8aedddcb223e583da394ee735de36b5815f8f1d22cb49be15 /uv /uvx /bin/

# Copy official maintained GitHub MCP server binary
COPY --from=ghcr.io/github/github-mcp-server:v1.11.0@sha256:fbec75de11c255213fa08d80fb166abe73d851fff631c51c0079872967720699 /server/github-mcp-server /usr/local/bin/github-mcp-server

# ── Create unprivileged service user dsh (UID/GID 1000) ────────────
RUN usermod -l dsh -d /home/dsh -m node \
    && groupmod -n dsh node \
    && mkdir -p /home/dsh/.local/bin /var/lib/dsh /var/lib/dsh-state /app /run/dsh /var/log/dsh /etc/dsh /opt/uv-tools \
    && chown -R dsh:dsh /home/dsh /var/lib/dsh /var/lib/dsh-state /app /run/dsh /var/log/dsh /etc/dsh /opt/uv-tools

# Install official DeepSeek Harness engine and minimal runtime dependencies (no build compilers, no GUI bloat)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    util-linux \
    make \
    g++ \
    && npm install -g @deepseek-ai/dsh@0.1.2-rc.1 pnpm@11.25.0 yaml@2.7.0 @mzxrai/mcp-webresearch@0.1.7 @upstash/context7-mcp@1.0.14 \
    && npm cache clean --force \
    && UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin uv tool install --with 'mcp<2.0.0' mcp-server-sqlite@2025.4.25 \
    && ln -sf /usr/local/bin/mcp-server-sqlite /home/dsh/.local/bin/mcp-server-sqlite \
    && apt-get purge -y --auto-remove make g++ \
    && rm -rf /var/lib/apt/lists/* /root/.cache /root/.npm \
    && chmod -R 755 /usr/local/bin /usr/local/lib/node_modules /opt/uv-tools

ENV HOME="/home/dsh"
ENV PATH="/home/dsh/.local/bin:/usr/local/bin:${PATH}"
ENV DSH_HOME="/var/lib/dsh"
ENV DSH_CONFIG_DIR="/etc/dsh"
ENV NODE_PATH="/usr/local/lib/node_modules:/app/prebuilt-profiles/web/node_modules:/var/lib/dsh/profiles/web/node_modules:/root/.dsh/profiles/web/node_modules:/root/.dsh/profiles/node_modules"

# Setup directories, shebang for internals exposure, and global CLI link
RUN mkdir -p /home/dsh/.mnemon/runtime /var/lib/dsh/profiles/web /var/lib/dsh/profiles/node_modules \
    /var/lib/dsh/storages /var/lib/dsh/sessions /var/lib/dsh/patch /var/lib/dsh/cache /run/dsh /workspaces \
    /opt/dsh-config /var/lib/dsh-state/sessions /var/lib/dsh-state/storages /var/log/dsh /app /etc/dsh \
    && chmod 0750 /var/log/dsh \
    && ln -sf ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh \
    && ln -sf ../lib/node_modules/@deepseek-ai/dsh/node_modules/.bin/cordis /usr/local/bin/cordis \
    && ln -sf /var/lib/dsh /home/dsh/.dsh \
    && ln -sf /var/lib/dsh /root/.dsh

COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN chmod 0755 /usr/local/bin/dsh-entrypoint \
    && sh -n /usr/local/bin/dsh-entrypoint

# Copy pre-compiled and pre-built plugins to both internal cache and default profile location
COPY --from=builder /home/dsh/.local/share/pnpm/store /home/dsh/.local/share/pnpm/store
COPY --from=builder /var/lib/dsh/profiles/web /app/prebuilt-profiles/web
COPY --from=builder /var/lib/dsh/profiles/web /var/lib/dsh/profiles/web
COPY config/cordis.patch.yml /var/lib/dsh/cordis.patch.yml
COPY config/cordis.patch.yml /opt/dsh-config/cordis.patch.yml
COPY config/cordis.patch.yml /etc/dsh/cordis.patch.yml
COPY config/profiles/web/cordis.patch.yml /app/prebuilt-profiles/web/cordis.patch.yml
COPY config/profiles/web/cordis.patch.yml /var/lib/dsh/profiles/web/cordis.patch.yml
COPY config/profiles/headless/cordis.patch.yml /app/prebuilt-profiles/headless/cordis.patch.yml
COPY config/profiles/headless/cordis.patch.yml /var/lib/dsh/profiles/headless/cordis.patch.yml
COPY config/profiles/cli/cordis.yml /app/prebuilt-profiles/cli/cordis.yml
COPY config/profiles/cli/cordis.yml /var/lib/dsh/profiles/cli/cordis.yml

# Complete profile peer dependencies from DSH's runtime dependency tree (never symlink scope dirs)
RUN for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/* /usr/local/lib/node_modules/@deepseek-ai/*; do \
      case "$(basename "$p")" in \
        @*) \
          mkdir -p "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")"; \
          for sub in "$p"/*; do \
            [ -e "$sub" ] && [ ! -e "/app/prebuilt-profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" ] \
              && ln -s "$sub" "/app/prebuilt-profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" || true; \
            [ -e "$sub" ] && [ ! -e "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" ] \
              && ln -s "$sub" "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")/$(basename "$sub")" || true; \
          done ;; \
        *) \
          [ -e "$p" ] && [ ! -e "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" ] \
            && ln -s "$p" "/app/prebuilt-profiles/web/node_modules/$(basename "$p")" || true; \
          [ -e "$p" ] && [ ! -e "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")" ] \
            && ln -s "$p" "/var/lib/dsh/profiles/web/node_modules/$(basename "$p")" || true; ;; \
      esac; \
    done

# ESM plugins resolve DeepSeek scoped dependencies from their own profile tree.
RUN mkdir -p /app/prebuilt-profiles/web/node_modules/@deepseek-ai /var/lib/dsh/profiles/web/node_modules/@deepseek-ai && \
    for p in /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/* /usr/local/lib/node_modules/@deepseek-ai/*; do \
      [ -e "$p" ] && ln -sfn "$p" "/app/prebuilt-profiles/web/node_modules/@deepseek-ai/$(basename "$p")" && \
      ln -sfn "$p" "/var/lib/dsh/profiles/web/node_modules/@deepseek-ai/$(basename "$p")"; \
    done

# Link profile node_modules globally into /usr/local/lib/node_modules and /app/node_modules
RUN for p in /var/lib/dsh/profiles/web/node_modules/*; do [ -e "$p" ] && ln -sf "$p" "/usr/local/lib/node_modules/$(basename "$p")" || true; done && \
    for p in /var/lib/dsh/profiles/web/node_modules/@*/*; do [ -e "$p" ] && mkdir -p "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)" && ln -sf "$p" "/usr/local/lib/node_modules/$(dirname "$p" | xargs basename)/$(basename "$p")" || true; done && \
    ln -sf /var/lib/dsh/profiles/web/node_modules /app/node_modules

# Copy and link native in-tree @dsh-dds/core Cordis plugin
COPY packages/dsh-dds-core /app/packages/dsh-dds-core
COPY config/audit-writer-core.mjs config/audit-writer.mjs config/telemetry-gateway.mjs /app/services/
RUN mkdir -p /usr/local/lib/node_modules/@dsh-dds /app/prebuilt-profiles/web/node_modules/@dsh-dds /var/lib/dsh/profiles/web/node_modules/@dsh-dds \
    && ln -sfn /app/packages/dsh-dds-core /usr/local/lib/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /app/prebuilt-profiles/web/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /var/lib/dsh/profiles/web/node_modules/@dsh-dds/core

# Standard unadulterated pnpm engine configured for unprivileged non-root runtime store
RUN ln -sf /usr/local/lib/node_modules/pnpm/bin/pnpm.mjs /usr/local/bin/pnpm \
    && ln -sf /usr/local/bin/pnpm /usr/local/bin/pn \
    && mkdir -p /home/dsh/.local/share/pnpm/store /home/dsh/.config/pnpm \
    && echo "store-dir=/home/dsh/.local/share/pnpm/store" >> /home/dsh/.pnpmrc \
    && echo "minimum-release-age=0" >> /home/dsh/.pnpmrc \
    && echo "minimumReleaseAge: 0" > /home/dsh/.config/pnpm/config.yaml

# Universal Runtime Compatibility & Sandboxing Loader (Zero Disk Patches)
ENV NODE_OPTIONS="--import /app/packages/dsh-dds-core/loader.mjs"

# The profile tree stays writable for profile installs, but the @dsh-dds scope must not
# be: a dsh-writable symlink there lets the agent shadow its own policy plugin through
# bare-specifier resolution, bypassing the root ownership of /app.
RUN chown -R dsh:dsh /home/dsh /var/lib/dsh /var/lib/dsh-state /run/dsh /var/log/dsh /etc/dsh \
    && chown -R root:root /app \
    && chmod -R 755 /app \
    && chown -R root:root /var/lib/dsh/profiles/web/node_modules/@dsh-dds \
    && chmod -R 755 /var/lib/dsh/profiles/web/node_modules/@dsh-dds

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3080/dsh-dds/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER dsh:dsh
WORKDIR /home/dsh

ENTRYPOINT ["/usr/local/bin/dsh-entrypoint"]

# Dedicated command-executor target. It deliberately inherits the pinned runtime so the
# versioned Landlock launcher shipped with DSH is available, but runs a single narrow
# Unix-socket service without the DSH entrypoint or application environment.
FROM runner AS isolated-executor

USER root
COPY services/isolated-executor /app/services/isolated-executor
RUN useradd --uid 11000 --gid dsh --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin dsh-executor \
    && mkdir -p /run/dsh-executor \
    && chown dsh-executor:dsh /run/dsh-executor \
    && chmod 0770 /run/dsh-executor

ENV NODE_OPTIONS=""
USER dsh-executor:dsh
WORKDIR /workspaces
ENTRYPOINT ["node", "/app/services/isolated-executor/server.mjs"]
EOF
fi

# 6. Write Production Docker Compose Layout with localhost port bindings and sanitized telemetry
if write_file_safe "$DSH_INSTALL/docker-compose.yml"; then
cat << 'EOF' > "$DSH_INSTALL/docker-compose.yml"
services:
  dsh:
    build: .
    image: dsh-local:latest
    user: "${DSH_UID:-1000}:${DSH_GID:-1000}"
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4096M
        reservations:
          cpus: '0.5'
          memory: 512M
    ports:
      - "127.0.0.1:${DSH_PORT:-3080}:3080"
    volumes:
      - ./config:/etc/dsh:ro
      - ./config/sessions:/var/lib/dsh/sessions:rw
      - ./config/users:/var/lib/dsh/users:rw
      - ./config/storages:/var/lib/dsh/storages:rw
      - ./config/patch:/var/lib/dsh/patch:rw
      - ./config/personas:/var/lib/dsh/personas:ro
      - ./config/skills:/var/lib/dsh/skills:ro
      - ./config/cache:/var/lib/dsh/cache:rw
      - ./workspaces:/workspaces:ro
      - ./workspaces/cases:/workspaces/cases:rw
      - ./workspaces/artifacts:/artifacts:rw
      - executor-socket:/run/dsh-executor:rw
    tmpfs:
      - /run/dsh:rw,size=32m,mode=1777
      - /tmp:rw,size=512m,mode=1777
    environment:
      - PORT=3080
      - NODE_ENV=production
      - NODE_PATH=/usr/local/lib/node_modules:/app/prebuilt-profiles/web/node_modules:/var/lib/dsh/profiles/web/node_modules:/root/.dsh/profiles/web/node_modules:/root/.dsh/profiles/node_modules
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
      - GEMINI_API_KEY=${GEMINI_API_KEY:-}
      - TAVILY_API_KEY=${TAVILY_API_KEY:-}
      - FIRECRAWL_API_KEY=${FIRECRAWL_API_KEY:-}
      - EXA_API_KEY=${EXA_API_KEY:-}
      - GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN:-}
      - GITHUB_TOKEN=${GITHUB_PERSONAL_ACCESS_TOKEN:-}
      - DSH_TELEMETRY_MODE=FULL
      - DSH_TELEMETRY_OTLP_URL=http://telemetry-gateway:4318/v1/traces
      - PHOENIX_URL=http://telemetry-gateway:4318
      - DSH_SERVICE_PROBE_ALLOW_HOSTS=telemetry-gateway
      - DSH_SERVICE_PROBE_ALLOW_PORTS=4318
      - DSH_APPROVAL_PUBLIC_KEY=${DSH_APPROVAL_PUBLIC_KEY:-}
      - DSH_RESTART_CSRF_TOKEN=${DSH_RESTART_CSRF_TOKEN:-}
      - DSH_VAULT_MASTER_KEY=${DSH_VAULT_MASTER_KEY:-}
      - DSH_HOME=/var/lib/dsh
      - DSH_CONFIG_DIR=/etc/dsh
      # Authorization grants require a receipt from the separately trusted writer.
      # This container has neither the ledger mount nor its integrity key.
      - DSH_AUDIT_WRITER_URL=http://audit-writer:3091/v1/events
      - DSH_AUDIT_WRITER_TOKEN=${DSH_AUDIT_WRITER_TOKEN:-}
      - DSH_AUDIT_WRITER_REQUIRED=1
      - DSH_SETTINGS_FILE=/var/lib/dsh/storages/settings.yaml
      # Legacy in-process escape hatch remains off. DSH_EXECUTOR_MODE routes approved
      # shell calls to the separate capability-gated executor below.
      - DSH_ALLOW_UNCONFINED_SHELL=${DSH_ALLOW_UNCONFINED_SHELL:-0}
      - DSH_EXECUTOR_MODE=isolated
      - DSH_EXECUTOR_SOCKET=/run/dsh-executor/executor.sock
      - DSH_EXECUTOR_CAPABILITY_KEY=${DSH_EXECUTOR_CAPABILITY_KEY:-}
    depends_on:
      telemetry-gateway:
        condition: service_healthy
      audit-writer:
        condition: service_healthy
      isolated-executor:
        condition: service_healthy
    networks:
      - dsh-runtime
      - audit-internal
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  audit-writer:
    build: .
    image: dsh-local:latest
    entrypoint: ["node", "/app/services/audit-writer.mjs"]
    user: "${DSH_UID:-1000}:${DSH_GID:-1000}"
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 32
    mem_limit: 256m
    cpus: 0.5
    environment:
      - DSH_AUDIT_WRITER_PORT=3091
      - DSH_AUDIT_WRITER_TOKEN=${DSH_AUDIT_WRITER_TOKEN:-}
      - DSH_AUDIT_INTEGRITY_KEY=${DSH_AUDIT_INTEGRITY_KEY:-}
      - DSH_AUDIT_LOG_FILE=/var/lib/dsh/audit/audit_grc.jsonl
      - DSH_AUDIT_CHECKPOINT_FILE=/var/lib/dsh/checkpoints/audit_head.jsonl
    volumes:
      - ./config/audit:/var/lib/dsh/audit:rw
      - ./config/audit-checkpoints:/var/lib/dsh/checkpoints:rw
    tmpfs:
      - /tmp:rw,nosuid,nodev,noexec,size=32m,mode=0700,uid=1000,gid=1000
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3091/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
    networks:
      - audit-internal

  telemetry-gateway:
    build: .
    image: dsh-local:latest
    entrypoint: ["node", "/app/services/telemetry-gateway.mjs"]
    user: "${DSH_UID:-1000}:${DSH_GID:-1000}"
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 32
    mem_limit: 256m
    cpus: 0.5
    environment:
      - PORT=4318
      - PHOENIX_UPSTREAM_URL=http://phoenix:6006
      - PHOENIX_INGEST_TOKEN=${PHOENIX_API_KEY:-}
    tmpfs:
      - /tmp:rw,nosuid,nodev,noexec,size=32m,mode=0700,uid=1000,gid=1000
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4318/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
    depends_on:
      phoenix:
        condition: service_healthy
    networks:
      - dsh-runtime
      - phoenix-internal

  isolated-executor:
    build:
      context: .
      target: isolated-executor
    image: dsh-isolated-executor:latest
    restart: unless-stopped
    init: true
    read_only: true
    network_mode: none
    user: "11000:${DSH_GID:-1000}"
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    pids_limit: 64
    mem_limit: 512m
    cpus: 1.0
    environment:
      - DSH_EXECUTOR_SOCKET=/run/dsh-executor/executor.sock
      - DSH_EXECUTOR_CAPABILITY_KEY=${DSH_EXECUTOR_CAPABILITY_KEY:-}
      # Commands share the executor PID namespace; serialize until per-invocation PID
      # namespaces are available so tenants never execute concurrently.
      - DSH_EXECUTOR_MAX_CONCURRENT=1
    volumes:
      - executor-socket:/run/dsh-executor:rw
      - ./workspaces/users:/workspaces/users:rw
      - ./workspaces/cases:/workspaces/cases:rw
      - ./workspaces/shared:/workspaces/shared:ro
    tmpfs:
      - /tmp:rw,nosuid,nodev,noexec,size=64m,mode=0700,uid=11000,gid=1000
    healthcheck:
      test: ["CMD", "node", "-e", "const n=require('net').connect('/run/dsh-executor/executor.sock');n.on('connect',()=>{n.end();process.exit(0)});n.on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s

  phoenix:
    image: arizephoenix/phoenix:20.5.0@sha256:39374ee6ad0c69c0a5e713e42e869f70ae99f681e0dbad374721a5ccecd0d54d
    user: "${DSH_UID:-1000}:${DSH_GID:-1000}"
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    ports:
      - "127.0.0.1:6006:6006"
      - "127.0.0.1:4317:4317"
      - "127.0.0.1:4318:4318"
    deploy:
      resources:
        limits:
          cpus: '1.5'
          memory: 2048M
        reservations:
          cpus: '0.25'
          memory: 512M
    command:
      - "-c"
      - "import os, sys; os.environ.pop('PHOENIX_SECRET', None) if not os.environ.get('PHOENIX_SECRET') else None; from phoenix.server.main import main; sys.argv = ['phoenix', 'serve']; main()"
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6006/')"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
    environment:
      - HOME=/home/phoenix
      - PHOENIX_WORKING_DIR=/home/phoenix/.phoenix
      - PHOENIX_PORT=6006
      - PHOENIX_GRPC_PORT=4317
      - PHOENIX_MAX_DAYS_RETENTION=14
      - PHOENIX_SECRET=${PHOENIX_SECRET:-}
      - PHOENIX_ADMIN_SECRET=${PHOENIX_ADMIN_SECRET:-}
      - PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD=${PHOENIX_DEFAULT_ADMIN_INITIAL_PASSWORD:-}
      - PHOENIX_ENABLE_AUTH=true
    volumes:
      - ./config/phoenix:/home/phoenix/.phoenix
    networks:
      - phoenix-internal
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  executor-socket:

networks:
  dsh-runtime:
    driver: bridge
  phoenix-internal:
    driver: bridge
    internal: true
  audit-internal:
    driver: bridge
    internal: true
EOF
fi

echo "=========================================================="
echo "✅ Architecture built cleanly at: $DSH_INSTALL"
echo "🛠️  Execution Steps:"
if [ "$DSH_INSTALL" != "$(pwd)" ]; then
  echo "  1. Navigate to your installation folder: cd $DSH_INSTALL"
  echo "  2. Build & boot up the environment: docker compose up -d --build"
else
  echo "  1. Build & boot up the environment: docker compose up -d --build"
fi
echo "=========================================================="
