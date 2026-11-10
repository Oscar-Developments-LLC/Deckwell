#!/bin/sh
# For a Panel over SSH. Shows the processes using the most CPU right now, with their memory use.
printf "%6s %6s  %s\n" "CPU%" "MEM%" "NAME"
ps -eo pcpu,pmem,comm --sort=-pcpu | sed 1d | head -n 12 | awk '{ printf "%6.1f %6.1f  %s\n", $1, $2, $3 }'
