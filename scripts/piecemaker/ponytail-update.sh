#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
timestamp_file="$project_dir/.claude/ponytail-last-update"
last_update=0
if [ -f "$timestamp_file" ]; then
    read -r last_update < "$timestamp_file" || last_update=0
fi
case "$last_update" in
    ''|*[!0-9]*) last_update=0 ;;
esac
if [ "$(($(date +%s) - last_update))" -lt 604800 ]; then
    exit 0
fi

cd "$project_dir"
claude plugin marketplace update ponytail
claude plugin update ponytail@ponytail --scope local
date +%s > "$timestamp_file"
cat "$timestamp_file"
