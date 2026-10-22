#!/bin/sh
# For a Status tile over SSH. Prints "running/total|containers up|fraction|up-or-down".
# Copy this file to your server (for example ~/deckwell/status-containers.sh), run
#   chmod +x ~/deckwell/status-containers.sh
# and set the tile's Command to:  ~/deckwell/status-containers.sh
# The SSH user must be allowed to run docker (in the "docker" group).
total=$(docker ps -aq | wc -l)
running=$(docker ps -q | wc -l)
if [ "$total" -eq 0 ]; then
  echo "0|no containers||up"
  exit 0
fi
state=up
[ "$running" -lt "$total" ] && state=down
echo "$running/$total|containers up|$(awk "BEGIN { printf \"%.2f\", $running / $total }")|$state"
