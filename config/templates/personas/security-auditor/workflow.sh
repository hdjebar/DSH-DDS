#!/usr/bin/env bash
# 🛡️ Security Auditor Workflows

WORKFLOW="${1:-diff}"

case "$WORKFLOW" in
  diff)
    ./dsh.sh run "Using the security-auditor skill, audit git diff HEAD~1 for vulnerabilities and provide patch diffs."
    ;;
  secrets)
    ./dsh.sh run "Using the security-auditor skill, scan the repository for hardcoded tokens, passwords, and private keys."
    ;;
  *)
    echo "Available workflows: diff, secrets"
    ;;
esac
