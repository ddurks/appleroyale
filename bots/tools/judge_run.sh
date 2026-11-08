#!/bin/sh
# JUDGE: run referee stats for every layout x bot set in parallel.
# usage: sh bots/tools/judge_run.sh <outdir> <rounds> <seed> <botset>...
# each botset is a --bots value; output <outdir>/<layout>__<n>.json
out=$1; R=$2; seed=$3; shift 3
mkdir -p "$out"
dir=$(cd "$(dirname "$0")/.." && pwd)
n=0; : > "$out/jobs.txt"
for b in "$@"; do
  for L in rows patterns setpieces tempo; do
    echo "$L $n $b" >> "$out/jobs.txt"
  done
  echo "$n $b" >> "$out/sets.txt"; n=$((n+1))
done
cat "$out/jobs.txt" | xargs -P 8 -L 1 sh -c 'node "'"$dir"'/layout_arena.js" stats "$0" --bots "$2" --rounds '"$R"' --seed '"$seed"' > "'"$out"'/$0__$1.json"'
