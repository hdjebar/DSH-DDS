#!/usr/bin/env bash
# 🌐 SDMX Expert Workflows

WORKFLOW="${1:-lustat}"

case "$WORKFLOW" in
  lustat)
    ./dsh.sh run "Using the sdmx-expert skill, discover latest available dataflows in LUSTAT (LU1) and list top 5 indicators."
    ;;
  eurostat)
    ./dsh.sh run "Using the sdmx-expert skill, show how to query Eurostat (ESTAT) dataflow for harmonized CPI."
    ;;
  *)
    echo "Available workflows: lustat, eurostat"
    ;;
esac
