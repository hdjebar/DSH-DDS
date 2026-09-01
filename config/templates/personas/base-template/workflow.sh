#!/usr/bin/env bash
# Universal Base Workflows

WORKFLOW="${1:-default}"

case "$WORKFLOW" in
  default)
    ./dsh.sh run "Using the base-template skill, execute the standard domain workflow."
    ;;
  reasoning)
    ./dsh.sh run --patch <(echo "- id: agent-default-model
  config:
    provider: openrouter
    model: deepseek/deepseek-r1") "Using the base-template skill, analyze complex domain problems."
    ;;
  *)
    echo "Available workflows: default, reasoning"
    ;;
esac
