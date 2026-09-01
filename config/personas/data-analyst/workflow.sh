#!/usr/bin/env bash
# 📊 Data Analyst Workflows

WORKFLOW="${1:-summarize}"

case "$WORKFLOW" in
  summarize)
    ./dsh.sh run "Using the data-analyst skill, analyze datasets in /workspaces and generate an executive summary table."
    ;;
  schema)
    ./dsh.sh run "Using the data-analyst skill, connect to /workspaces/data.db and audit database schemas and indexes."
    ;;
  *)
    echo "Available workflows: summarize, schema"
    ;;
esac
