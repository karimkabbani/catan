#!/usr/bin/env bash
# runbench.sh <out.csv> cfg [cfg...]: 3 sequential runs of bench3.js per cfg (parallel runs skew each other).
OUT="$1"; shift
for c in "$@"; do for r in 1 2 3; do NODE_PATH=$(npm root -g) node bench3.js "$c" "$r" 2>&1 | tail -1 | tee -a "$OUT"; done; done
