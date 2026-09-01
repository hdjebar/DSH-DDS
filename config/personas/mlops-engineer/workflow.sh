#!/usr/bin/env bash
# Mlops Engineer Automation Recipes

WORKFLOW="${1:-default}"

case "$WORKFLOW" in
  default)
    ./dsh.sh persona run mlops-engineer "execute standard Mlops Engineer workflow"
    ;;
  reasoning)
    ./dsh.sh persona run mlops-engineer --tier reasoning "perform deep Mlops Engineer analysis"
    ;;
  *)
    echo "Available workflows: default, reasoning"
    ;;
esac
