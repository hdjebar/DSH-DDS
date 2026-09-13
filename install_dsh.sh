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

# 2. Strict & Safe Environment Variable Loader (Finding H-1)
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

      # Hard-deny dangerous execution/injection variables and source redirects (Finding H-1)
      case "$key" in
        LD_PRELOAD|LD_LIBRARY_PATH|BASH_ENV|ENV|SHELLOPTS|NODE_OPTIONS|PYTHONPATH|RUBYOPT|PERL5OPT|DSH_REPO_URL|DSH_SOURCE_DIR|DSH_REF|DSH_INSTALL)
          echo "⚠️  Security Warning: Refusing to load restricted environment variable '$key' from $env_file." >&2
          continue
          ;;
      esac

      # Strict allowlist of permissible configuration variables
      case "$key" in
        DSH_*|PHOENIX_*|GEMINI_API_KEY|OPENROUTER_API_KEY|GITHUB_PERSONAL_ACCESS_TOKEN)
          export "$key=$val"
          ;;
        *)
          echo "⚠️  Security Warning: Ignoring unrecognized key '$key' from $env_file." >&2
          ;;
      esac
    fi
  done < "$env_file"
}

if [ -f "$DSH_INSTALL/.env" ]; then
  chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
  echo "📝 Loading environment variables from $DSH_INSTALL/.env..."
  load_env_safely "$DSH_INSTALL/.env"
elif [ -f ".env" ]; then
  echo "📝 Copying local .env to $DSH_INSTALL/.env and loading variables..."
  ( umask 077 && cp .env "$DSH_INSTALL/.env" )
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
    if [ -n "${input_port:-}" ]; then
      if ! [[ "$input_port" =~ ^[0-9]{1,5}$ ]] || [ "$input_port" -lt 1 ] || [ "$input_port" -gt 65535 ]; then
        echo "❌ Error: Invalid DSH Web Port '$input_port'. Must be a number between 1 and 65535." >&2
        exit 1
      fi
    fi
    
    AUTO_APPROVAL_SECRET="$(generate_secret)"
    VAULT_MASTER_KEY="$(generate_secret)"
    RESTART_CSRF_TOKEN="$(generate_secret)"
    AUDIT_INTEGRITY_KEY="$(generate_secret)"
    EXECUTOR_CAPABILITY_KEY="$(generate_secret)"
    AUDIT_WRITER_TOKEN="$(generate_secret)"
    PHOENIX_SECRET="$(generate_secret)"
    PHOENIX_ADMIN_SECRET="dsh0_$(generate_secret)"
    PHOENIX_INITIAL_PASSWORD="dsh0_$(generate_secret)"
    (
      umask 077
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
PHOENIX_INGEST_TOKEN=
DSH_APPROVAL_SECRET=${AUTO_APPROVAL_SECRET}
DSH_APPROVAL_PUBLIC_KEY_FILE=
DSH_VAULT_MASTER_KEY=${VAULT_MASTER_KEY}
DSH_RESTART_CSRF_TOKEN=${RESTART_CSRF_TOKEN}
DSH_AUDIT_INTEGRITY_KEY=${AUDIT_INTEGRITY_KEY}
DSH_AUDIT_WRITER_TOKEN=${AUDIT_WRITER_TOKEN}
DSH_EXECUTOR_CAPABILITY_KEY=${EXECUTOR_CAPABILITY_KEY}
EOF
    )
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
    (
      umask 077
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
PHOENIX_INGEST_TOKEN=
DSH_APPROVAL_SECRET=${AUTO_APPROVAL_SECRET}
DSH_APPROVAL_PUBLIC_KEY_FILE=
DSH_VAULT_MASTER_KEY=${VAULT_MASTER_KEY}
DSH_RESTART_CSRF_TOKEN=${RESTART_CSRF_TOKEN}
DSH_AUDIT_INTEGRITY_KEY=${AUDIT_INTEGRITY_KEY}
DSH_AUDIT_WRITER_TOKEN=${AUDIT_WRITER_TOKEN}
DSH_EXECUTOR_CAPABILITY_KEY=${EXECUTOR_CAPABILITY_KEY}
EOF
    )
    chmod 0600 "$DSH_INSTALL/.env" 2>/dev/null || true
    echo "📝 Generated starter $DSH_INSTALL/.env template (mode 0600). You can populate keys anytime in .env."
    load_env_safely "$DSH_INSTALL/.env"
  fi
fi

if [ -n "${DSH_PORT:-}" ]; then
  if ! [[ "$DSH_PORT" =~ ^[0-9]{1,5}$ ]] || [ "$DSH_PORT" -lt 1 ] || [ "$DSH_PORT" -gt 65535 ]; then
    echo "❌ Error: Invalid DSH_PORT '$DSH_PORT'. Must be a numeric port between 1 and 65535." >&2
    exit 1
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

# --- BEGIN PROVISIONING MANIFEST ---
get_manifest_sha256() {
  case "$1" in
    "dsh.sh") echo "23cbf19d8903e84d0c58f65bb069c09811482f47eb4216e2603c6f3e493f9dfa" ;;
    "reset.sh") echo "875f9470347db8c329e90a4f31195d78356388e30583504cb1baf34f5c5f7a7f" ;;
    "docker-compose.sandbox.yml") echo "cab777bf18452669d83547ba78f7cdf01410f12cda4301e659bf4a8706cf9be2" ;;
    "docker-compose.dev.yml") echo "9a1e07866cdb852cd282997cdf89c81e5193c49a5a36ef5f9dce0abf06783f9e" ;;
    "docker/entrypoint.sh") echo "85dd8b596da80ae52b8120d3c93a04815514df32871d3a0f29f3da618adcc1d3" ;;
    "services/isolated-executor/server.mjs") echo "a0ddca1c64402ad896d77cba6df59a9fc226c8568ccb942223006b15030b8b31" ;;
    "scripts/prepare_executor_workspaces.mjs") echo "43844ac882b96e4aa2b7d4a6fc3d1c7e3c5e9ebc71dbdeb929ffa77963e82ada" ;;
    "scripts/migrate_tenant_partitions.mjs") echo "beec8d23e98214e627bdf559cee8cb221fa09820e7822e5b650d13787262e13e" ;;
    "scripts/lib/tenant_partition_migration.mjs") echo "ac34288219f2c6d53925f559043fceaf4f5eac8989e054e15eb4c1918ee1130c" ;;
    "scripts/export_telemetry.sh") echo "8e24147d7d2583fcb9b43269ca6ac33787d6944f802a43de100e92539b7c3d82" ;;
    "scripts/prune_telemetry.sh") echo "b0c72bb4fd3a510fd052e7b43ac7514b48b9eed1d0fa7eeb813fd3b441eb0c90" ;;
    "config/sync_models.mjs") echo "26431510158e493040c02283c72c7980bc5a828f6d3247c548961fdf4e6dbf52" ;;
    "config/doctor.mjs") echo "9507ef2fa45bb14c03a7f5a7a220a821b4f55eae5715f64979cfc88701efff99" ;;
    "config/persona.mjs") echo "8edb1511166a51f9accc2c5fe70582bbfedf7a6b8c8922d8f34d1625ac0e9eaa" ;;
    "config/declarative-orchestrator.mjs") echo "d87877fd39378eeb90fda9c7bc4efed759b106ee80d7f6dd29fb5dca432485eb" ;;
    "config/outbound-security.mjs") echo "64bebb80cac5bd876418d93306416153e58f079aa024f5f54d8966aabcc1db33" ;;
    "config/audit-client.mjs") echo "3ca4bb715f3a1f1213d399ba8c10d3e51ffca3014309022e8b9f63ea64ae3717" ;;
    "config/audit-writer-core.mjs") echo "bb7a698a2b05a2e6c855683601c23849197c89c8864a836869a044021b1c2495" ;;
    "config/audit-writer.mjs") echo "8a417a4c14f2471e1444856c7861587b14b120a3caec0774db9cfd9de97977f3" ;;
    "config/telemetry-gateway.mjs") echo "517a0f9a210fcf0fc3319e422a9d4e4616e44a58aca46d2ba12797afe9b98143" ;;
    "config/audit-checkpoints/.gitkeep") echo "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b" ;;
    "config/rbac-policy.mjs") echo "f28af4ad115a25bf72b4968b6695ee8564ec2405d346e10b6fd2ad49219a10ec" ;;
    "config/policy-manifest.mjs") echo "44e47cf95541dcf58d93ff9f39e88e3922f4e5490d0bb264eafe14dad3c85ba1" ;;
    "config/settings.default.yaml") echo "1c7e2691e04edd13344314dc1449a5b8498e49ccb0fc13ea7386db7f72954769" ;;
    "config/phoenix-evals.mjs") echo "adda595b491d85e43dc13115d01f9fcdd3cbc98917e2c2fde6bef8351484adab" ;;
    "config/context-quarantine.mjs") echo "0cfbad5ee0f99a13af4f06087a51b2f5a2db156e86ce302f63e23d7ec01b8326" ;;
    "config/dynamic-governance.mjs") echo "553e27b65e6f07f0300a66caf376460a2c3948e531261242830890c57bac65d7" ;;
    "config/failover-gateway.mjs") echo "eca6c5d88b4177864d4315a5c05f8b6b77e627b62314bfadc0e8d2e53da7d3c0" ;;
    "config/worktree-staging.mjs") echo "a40579fa53f8d3b8a110018eeb19b9f7cef8b8df236a45b4e5d903f44cbc66ca" ;;
    "config/network/envoy-egress.yaml") echo "696ec577be0f9d35848dece28756a8d41cfb1aef631c8b385e307132bad803e0" ;;
    "config/schemas/persona-policy-v1.schema.json") echo "04d20f370eff912305e8242ed7b26092db3a73ec88678a30bbb0396d532540c6" ;;
    "config/schemas/tenant-partition-migration-v1.schema.json") echo "7ff258d2c57c1978eb1f30ca690a7b85c4c9607fd2a1028f98be16b45d4b8256" ;;
    "packages/dsh-dds-core/byok-vault.js") echo "1187c016bf95e96f26890ed6104a99c480159cd669db6f7e47448a685a4976c7" ;;
    "packages/dsh-dds-core/execution-capability.js") echo "fd28c02744c917a7ec71d3a773fe84d541f4642df7f2511bf9f6a301bea78aed" ;;
    "packages/dsh-dds-core/gateway.js") echo "f52724e569e2f864a0a8a0e3e4f75df9cf40d794984a8ac98eccbec994233eb2" ;;
    "packages/dsh-dds-core/iam.js") echo "ad192f53cfbb12134e0ea9885d9e01430a17eb2c7b744040ca2ff3529a38c0b2" ;;
    "packages/dsh-dds-core/index.js") echo "c015ba28d649579eec319db402b6ad5ebd664896afd2100afd61834c7d691129" ;;
    "packages/dsh-dds-core/isolated-shell-executor.js") echo "648587221285d137ca773971f0fb90029ada397bab3ac394f2fb1559dc69a889" ;;
    "packages/dsh-dds-core/llm-gateway.js") echo "b1f43c14866963ba6ca073533ae70ba6709135174c35b9a3fe403e3cca39b90d" ;;
    "packages/dsh-dds-core/loader-hooks.mjs") echo "390ce8b9833135a6d3bd41d5ef82b7267d9a1df58b993fc97db33e37aee61929" ;;
    "packages/dsh-dds-core/loader.mjs") echo "589ebe7451418533813c5a44aa8dc9654f74ba73155123521b4df6e52109391c" ;;
    "packages/dsh-dds-core/localization.js") echo "aaa2430de34f631bdc0085db3e203662a50506ce1e417c491da9b046ca49c32a" ;;
    "packages/dsh-dds-core/model-catalog.js") echo "4f37cc98d3007755887ac886e950bc8442a934cda81b656a93a1f6ed6f9491a5" ;;
    "packages/dsh-dds-core/net-trust.js") echo "32f92f2bef5ac57b02f682421a16e21f9e6c75ec2be7fa490b7e7ef8529ed4c4" ;;
    "packages/dsh-dds-core/package.json") echo "ad3994b9eb985ee10c411b19d2cd91f3eb2932e74e809b80179c99509110ccbd" ;;
    "packages/dsh-dds-core/rbac-interceptor.js") echo "ff8d5353d313920113185842ddc14b32dd4b33a30c6494e6694e0f2cab1f3675" ;;
    "packages/dsh-dds-core/user-partition.js") echo "3121583f75fbf5c78503e076207ecc8a0bac11c09730fe8f2ca699f99f35315f" ;;
    "packages/dsh-dds-core/web-search.js") echo "2ddfcc01f2245f4386b4b2f8602468ef7ee63d9d536e4ad73ae5861e0b36e425" ;;
    "config/profiles/cli/cordis.patch.yml") echo "476a93da63556f9b7edf3c049a12abaa00934a4e4a1e58be079f7422258b6e26" ;;
    "config/profiles/cli/cordis.yml") echo "c300dcf2ebc5f02062d6591268d29d3db6fe45e0cb138f5467276fe2ba06076e" ;;
    "config/profiles/cli/package.json") echo "854b8e8d2286571785aab5207e0b7e5ce56311eb0e25ed0391eacfe7abebd95f" ;;
    "config/profiles/cli/pnpm-lock.yaml") echo "716663b14d5f920668fc2a971acff4042fc03f9c35fd186b90084be1724bb8ac" ;;
    "config/profiles/headless/cordis.patch.yml") echo "476a93da63556f9b7edf3c049a12abaa00934a4e4a1e58be079f7422258b6e26" ;;
    "config/profiles/headless/cordis.yml") echo "c300dcf2ebc5f02062d6591268d29d3db6fe45e0cb138f5467276fe2ba06076e" ;;
    "config/profiles/headless/package.json") echo "563c0b6082748a6e93daad51514f01335c51fc9c44f5f88253383f18ac2557b5" ;;
    "config/profiles/headless/pnpm-workspace.yaml") echo "5b66cce9e0ce8c4d774154b36db6d1caadb9994470d1c128e3f81e95172ea20b" ;;
    "config/profiles/web/cordis.yml") echo "c300dcf2ebc5f02062d6591268d29d3db6fe45e0cb138f5467276fe2ba06076e" ;;
    "config/profiles/web/pnpm-lock.yaml") echo "24ce63f2d5b5719e350ed175e52d9c3a303cb1e05fb0834fed8cceb0787d0ae0" ;;
    "config/profiles/web/pnpm-workspace.yaml") echo "633bdda04c5388010d35456484aa5c52d9d87b34bb36a32b896efa52f5eed24c" ;;
    "config/personas/data-analyst/SKILL.md") echo "bf9938ed2a5dff12b0cab5d8eba0dab0fe9a835ed0ab7519f1a582c386d12241" ;;
    "config/personas/data-analyst/persona.yaml") echo "b30f6541f4f1825061c2e0c627f149bbd95e664be5037652c53cc8d5abe7beaa" ;;
    "config/personas/devops-sre/SKILL.md") echo "1fd256e8887664c5e5a59e104364655718b87ddfb2c246d74150174023720c50" ;;
    "config/personas/devops-sre/persona.yaml") echo "49723bde10d019fd1d6087da22478cf9dd76f12f7d7217517eb024c3737a9949" ;;
    "config/personas/mlops-engineer/SKILL.md") echo "ed67c2e65767eee5872504b6063f82b73f1a41bf90b2acf4f09e1b4d24ad789b" ;;
    "config/personas/mlops-engineer/persona.yaml") echo "6db2a87a418c01cbebbfda726d554a8820a27f0f7cc0137427b574d190807ad1" ;;
    "config/personas/persona-creator/SKILL.md") echo "bc4a7adaa58958601fcc80dc4ddc3289f5aa67b535783fae9027499e33d3b638" ;;
    "config/personas/persona-creator/persona.yaml") echo "a8c78ed1ecb14a944de5ebf6b4aa7ea545825aff636b7bb029e0971ef0f87603" ;;
    "config/personas/sdmx-expert/SKILL.md") echo "326df5161114bb644997f1949fa927e26c4f3cce15f86b76d8478fa793f6127c" ;;
    "config/personas/sdmx-expert/persona.yaml") echo "1fcbdcee4ce1ea997381229e57b3cbc01963be3ac26c71d7d5d147b18ec0c7c2" ;;
    "config/personas/security-auditor/SKILL.md") echo "7bbd483e9cddc87085bcb92c83abe872dfe342c189daa219594312410625986d" ;;
    "config/personas/security-auditor/persona.yaml") echo "0c850997901b79615319529f2a8fb0f0983f1fea2b61b4afb470b2446e4e33de" ;;
    "config/personas/stats-engineer/SKILL.md") echo "8462c97cbb4a04bb9895e15a799e51af5f513de848b7e0b5e9a864eb9d52d523" ;;
    "config/personas/stats-engineer/persona.yaml") echo "9bef06f20d8bd6fb68d6255e08ccd9c9fa6f0f1c1a91493bfb02506f4d38ffa4" ;;
    "config/skills/data-analyst/SKILL.md") echo "bf9938ed2a5dff12b0cab5d8eba0dab0fe9a835ed0ab7519f1a582c386d12241" ;;
    "config/skills/devops-sre/SKILL.md") echo "1fd256e8887664c5e5a59e104364655718b87ddfb2c246d74150174023720c50" ;;
    "config/skills/mlops-engineer/SKILL.md") echo "ed67c2e65767eee5872504b6063f82b73f1a41bf90b2acf4f09e1b4d24ad789b" ;;
    "config/skills/persona-creator/SKILL.md") echo "bc4a7adaa58958601fcc80dc4ddc3289f5aa67b535783fae9027499e33d3b638" ;;
    "config/skills/sdmx-expert/SKILL.md") echo "326df5161114bb644997f1949fa927e26c4f3cce15f86b76d8478fa793f6127c" ;;
    "config/skills/security-auditor/SKILL.md") echo "7bbd483e9cddc87085bcb92c83abe872dfe342c189daa219594312410625986d" ;;
    "config/skills/stats-engineer/SKILL.md") echo "8462c97cbb4a04bb9895e15a799e51af5f513de848b7e0b5e9a864eb9d52d523" ;;
    "config/templates/personas/base-template/SKILL.md") echo "87a30a61b4aa2e8ef81e30fcd735177f95ae5ecaa86088dfe7806da475e80ccc" ;;
    "config/templates/personas/base-template/persona.yaml") echo "9efc11f61a240192ca4613e66f2264783dbe701dcbd22cb45dc44be60bfd277b" ;;
    "config/templates/personas/data-analyst/SKILL.md") echo "bf9938ed2a5dff12b0cab5d8eba0dab0fe9a835ed0ab7519f1a582c386d12241" ;;
    "config/templates/personas/data-analyst/persona.yaml") echo "a7fc0cbac1245bef4151d9c28f360ad617121ef0673ff4d2068300316a2ebe1a" ;;
    "config/templates/personas/devops-sre/SKILL.md") echo "1fd256e8887664c5e5a59e104364655718b87ddfb2c246d74150174023720c50" ;;
    "config/templates/personas/devops-sre/persona.yaml") echo "c14026bdcb1eb61920b6410320ea2dcf3d28355c8d9a3954b97f6ff201dd3244" ;;
    "config/templates/personas/persona-creator/SKILL.md") echo "bc4a7adaa58958601fcc80dc4ddc3289f5aa67b535783fae9027499e33d3b638" ;;
    "config/templates/personas/persona-creator/persona.yaml") echo "5f1a4fc340f403940370561c039e708a2fd2e47c3350361f8ec0a4492f913dec" ;;
    "config/templates/personas/sdmx-expert/SKILL.md") echo "326df5161114bb644997f1949fa927e26c4f3cce15f86b76d8478fa793f6127c" ;;
    "config/templates/personas/sdmx-expert/persona.yaml") echo "b71b6a0afee67076926f6ad530bc99081e5cb091a4bf5abf2cba2d4214a10ac6" ;;
    "config/templates/personas/security-auditor/SKILL.md") echo "7bbd483e9cddc87085bcb92c83abe872dfe342c189daa219594312410625986d" ;;
    "config/templates/personas/security-auditor/persona.yaml") echo "6a44bbdbc47dcaa87b0596ee78d2251c4115831ff4c3208e9991027140607bbd" ;;
    *) echo "" ;;
  esac
}
# --- END PROVISIONING MANIFEST ---

verify_file_checksum() {
  local target_file="$1"
  local rel_path="$2"
  local expected_sha
  expected_sha="$(get_manifest_sha256 "$rel_path")"
  if [ -z "$expected_sha" ]; then
    echo "❌ Security Error: No authoritative SHA-256 hash defined in provisioning manifest for '$rel_path'." >&2
    exit 1
  fi

  local actual_sha=''
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha="$(sha256sum "$target_file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual_sha="$(shasum -a 256 "$target_file" | awk '{print $1}')"
  else
    echo "❌ Error: Neither sha256sum nor shasum is available to verify '$rel_path'." >&2
    exit 1
  fi

  if [ "$expected_sha" != "$actual_sha" ]; then
    echo "❌ Integrity Error: SHA-256 mismatch for fallback download '$rel_path'." >&2
    echo "   expected: $expected_sha" >&2
    echo "   actual:   $actual_sha" >&2
    exit 1
  fi
  echo "🔐 Verified SHA-256 integrity for fallback download '$rel_path'."
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
      verify_file_checksum "$stage_dest" "$rel_path"
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
fetch_or_copy_file "config/policy-manifest.mjs"
fetch_or_copy_file "config/settings.default.yaml"
# Stage settings.yaml for clean installs (FR-016)
if [ ! -f "$DSH_INSTALL/config/settings.yaml" ]; then
  if [ -f "$STAGE_DIR/config/settings.default.yaml" ]; then
    cp "$STAGE_DIR/config/settings.default.yaml" "$STAGE_DIR/config/settings.yaml"
  elif [ -f "$DSH_INSTALL/config/settings.default.yaml" ]; then
    cp "$DSH_INSTALL/config/settings.default.yaml" "$STAGE_DIR/config/settings.yaml"
  fi
fi
fetch_or_copy_file "config/phoenix-evals.mjs"
fetch_or_copy_file "config/context-quarantine.mjs"
fetch_or_copy_file "config/dynamic-governance.mjs"
fetch_or_copy_file "config/failover-gateway.mjs"
fetch_or_copy_file "config/worktree-staging.mjs"
fetch_or_copy_file "config/network/envoy-egress.yaml"
fetch_or_copy_file "dsh.sh"
fetch_or_copy_file "reset.sh"
fetch_or_copy_file "docker-compose.sandbox.yml"
fetch_or_copy_file "docker-compose.dev.yml"
fetch_or_copy_file "docker/entrypoint.sh"
fetch_or_copy_file "services/isolated-executor/server.mjs"
fetch_or_copy_file "scripts/prepare_executor_workspaces.mjs"
fetch_or_copy_file "scripts/migrate_tenant_partitions.mjs"
fetch_or_copy_file "scripts/lib/tenant_partition_migration.mjs"
fetch_or_copy_file "config/schemas/persona-policy-v1.schema.json"
fetch_or_copy_file "config/schemas/tenant-partition-migration-v1.schema.json"
fetch_or_copy_file "scripts/export_telemetry.sh"
fetch_or_copy_file "scripts/prune_telemetry.sh"

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
fetch_or_copy_file "config/profiles/cli/cordis.patch.yml"
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
    "config/policy-manifest.mjs"
    "config/settings.default.yaml"
    "config/settings.yaml"
    "config/phoenix-evals.mjs"
    "config/context-quarantine.mjs"
    "config/dynamic-governance.mjs"
    "config/failover-gateway.mjs"
    "config/worktree-staging.mjs"
    "config/network/envoy-egress.yaml"
    "dsh.sh"
    "reset.sh"
    "docker-compose.sandbox.yml"
    "docker-compose.dev.yml"
    "docker/entrypoint.sh"
    "services/isolated-executor/server.mjs"
    "scripts/prepare_executor_workspaces.mjs"
    "scripts/migrate_tenant_partitions.mjs"
    "scripts/lib/tenant_partition_migration.mjs"
    "config/schemas/persona-policy-v1.schema.json"
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
FROM node:26-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS builder

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
FROM node:26-bookworm-slim@sha256:cd9f682fa2885cd1056e830424764158570061c59736a1da836bc3d73df095ae AS runner

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
COPY config/profiles/cli/cordis.patch.yml /app/prebuilt-profiles/cli/cordis.patch.yml
COPY config/profiles/cli/cordis.patch.yml /var/lib/dsh/profiles/cli/cordis.patch.yml

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
RUN mkdir -p /usr/local/lib/node_modules/@dsh-dds \
    /app/prebuilt-profiles/web/node_modules/@dsh-dds /var/lib/dsh/profiles/web/node_modules/@dsh-dds \
    /app/prebuilt-profiles/headless/node_modules/@dsh-dds /var/lib/dsh/profiles/headless/node_modules/@dsh-dds \
    /app/prebuilt-profiles/cli/node_modules/@dsh-dds /var/lib/dsh/profiles/cli/node_modules/@dsh-dds \
    && ln -sfn /app/packages/dsh-dds-core /usr/local/lib/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /app/prebuilt-profiles/web/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /var/lib/dsh/profiles/web/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /app/prebuilt-profiles/headless/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /var/lib/dsh/profiles/headless/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /app/prebuilt-profiles/cli/node_modules/@dsh-dds/core \
    && ln -sfn /app/packages/dsh-dds-core /var/lib/dsh/profiles/cli/node_modules/@dsh-dds/core

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
      /var/lib/dsh/profiles/headless/node_modules/@dsh-dds \
      /var/lib/dsh/profiles/cli/node_modules/@dsh-dds \
    && chmod -R 755 /var/lib/dsh/profiles/web/node_modules/@dsh-dds \
      /var/lib/dsh/profiles/headless/node_modules/@dsh-dds \
      /var/lib/dsh/profiles/cli/node_modules/@dsh-dds

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

# Keep the application runtime as the default output of `docker build .`; Compose selects
# the isolated-executor stage explicitly for the dedicated command service.
FROM runner AS application
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
      # Prefer a scoped Phoenix system key; retain API_KEY fallback for existing installs
      # until the operator provisions the scoped key and removes bootstrap credentials.
      - PHOENIX_INGEST_TOKEN=${PHOENIX_INGEST_TOKEN:-}
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
    # UID 11000 has no effective capabilities. Keeping SYS_ADMIN only in its bounding set
    # lets Docker's default seccomp policy admit unshare(CLONE_NEWUSER); capabilities gained
    # after mapping root exist only inside the disposable nested user namespace.
    cap_add:
      - SYS_ADMIN
    pids_limit: 64
    mem_limit: 512m
    cpus: 1.0
    environment:
      - DSH_EXECUTOR_SOCKET=/run/dsh-executor/executor.sock
      - DSH_EXECUTOR_CAPABILITY_KEY=${DSH_EXECUTOR_CAPABILITY_KEY:-}
      # Serialize commands as an additional conservative availability control.
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
