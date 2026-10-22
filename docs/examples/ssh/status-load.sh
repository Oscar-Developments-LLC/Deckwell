#!/bin/sh
# For a Status tile over SSH. Shows the 1-minute load average, with load per core as the bar.
cores=$(nproc)
load=$(cut -d ' ' -f 1 /proc/loadavg)
echo "$load|load on $cores cores|$(awk "BEGIN { v = $load / $cores; if (v > 1) v = 1; printf \"%.2f\", v }")"
