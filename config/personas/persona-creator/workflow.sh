#!/usr/bin/env bash
# AI Persona & Workflow Architect Automation Recipes

WORKFLOW="${1:-default}"

case "$WORKFLOW" in
  design-workflow)
    ./dsh.sh persona run persona-creator --tier reasoning "Design an interactive visual workflow canvas (WORKFLOW.md and STEP.md) with deepseek-flow for the active workspace."
    ;;
  build-persona)
    ./dsh.sh persona run persona-creator --tier audit "Synthesize recent session insights and generate a complete 5-layer persona package."
    ;;
  benchmark)
    ./dsh.sh persona run persona-creator --tier fast "Audit persona traces and token latency in Arize Phoenix."
    ;;
  default|*)
    ./dsh.sh persona run persona-creator "Interview user and architect a new specialist AI persona."
    ;;
esac
