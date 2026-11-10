#!/bin/sh
# For a Panel over SSH. Shows every temperature sensor the server reports, one per line.
# Needs lm-sensors on the server (Debian/Ubuntu: sudo apt install lm-sensors, then sudo sensors-detect).
# Falls back to the kernel's thermal zones if sensors isn't installed.
if command -v sensors >/dev/null 2>&1; then
  sensors -A 2>/dev/null | awk -F: '/°C/ { name = $1; sub(/^[ \t]+/, "", $2); split($2, a, " "); printf "%-16s %s\n", name, a[1] }'
else
  for z in /sys/class/thermal/thermal_zone*; do
    [ -r "$z/temp" ] || continue
    printf "%-16s %d.%d C\n" "$(cat "$z/type")" $(($(cat "$z/temp") / 1000)) $((($(cat "$z/temp") % 1000) / 100))
  done
fi
