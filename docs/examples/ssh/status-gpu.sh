#!/bin/sh
# For a Status tile over SSH on a server with an NVIDIA GPU.
# Shows temperature, with GPU use as the bar: "61C|RTX 3090 - 23% busy|23".
nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,name --format=csv,noheader,nounits 2>/dev/null | head -n 1 |
  awk -F', ' '{ sub(/^NVIDIA GeForce /, "", $3); printf "%sC|%s - %s%% busy|%s\n", $1, $3, $2, $2 }'
