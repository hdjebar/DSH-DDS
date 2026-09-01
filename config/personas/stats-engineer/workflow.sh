#!/usr/bin/env bash
# Stats Engineer Automation Recipes

WORKFLOW="${1:-default}"

case "$WORKFLOW" in
  default)
    ./dsh.sh persona run stats-engineer "execute standard Stats Engineer workflow"
    ;;
  reasoning)
    ./dsh.sh persona run stats-engineer --tier reasoning "perform deep Stats Engineer analysis"
    ;;
  *)
    echo "Available workflows: default, reasoning"
    ;;
esac
