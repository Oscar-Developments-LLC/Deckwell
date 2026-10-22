#!/bin/sh
# For a Status tile over SSH. Shows how full a disk is, like "62%|120G free on /".
# Change MOUNT to the disk you care about (/, /mnt/storage, ...).
MOUNT=/
df -Ph "$MOUNT" | awk -v m="$MOUNT" 'NR == 2 { print $5 "|" $4 " free on " m }'
