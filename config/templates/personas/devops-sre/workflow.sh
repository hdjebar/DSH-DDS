#!/usr/bin/env bash
# 🚀 DevOps SRE Workflows

WORKFLOW="${1:-doctor}"

case "$WORKFLOW" in
  doctor)
    ./dsh.sh run "Using the devops-sre skill, run ./dsh.sh doctor and analyze container health status."
    ;;
  logs)
    ./dsh.sh run "Using the devops-sre skill, review recent logs from dsh and phoenix containers for anomalies."
    ;;
  *)
    echo "Available workflows: doctor, logs"
    ;;
esac
