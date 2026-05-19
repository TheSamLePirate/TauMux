#!/usr/bin/env bash
# Demo of OSC 9;4 progress reporting in τ-mux.
#
# Wire format: ESC ] 9 ; 4 ; <state> ; <progress> ESC \
#   state 0 = clear, 1 = normal, 2 = error, 3 = indeterminate, 4 = paused
#   progress = integer 0..100 (optional for 0/2/3/4)
#
# Watch the workspace progress bar (top of the workspace sidebar entry
# in the native app, and the workspace card in the web mirror) while
# this runs. Toggle via Settings → Advanced → "OSC 9;4 progress".
#
# Usage: bash scripts/demo_osc_progress.sh

set -u

ESC=$'\e'
ST=$'\e\\'

osc94() {
	# $1 = state, $2 = progress (optional)
	if [ $# -ge 2 ]; then
		printf '%s]9;4;%s;%s%s' "$ESC" "$1" "$2" "$ST"
	else
		printf '%s]9;4;%s%s' "$ESC" "$1" "$ST"
	fi
}

banner() {
	printf '\n\033[1;36m▶ %s\033[0m\n' "$1"
}

trap 'osc94 0; printf "\n\033[2mcleared progress on exit\033[0m\n"; exit' INT TERM

banner "1/5  Normal progress 0 → 100 over ~5s"
for pct in 0 10 20 30 40 50 60 70 80 90 100; do
	osc94 1 "$pct"
	printf '  normal: %3d%%\r' "$pct"
	sleep 0.4
done
printf '\n'
sleep 0.6

banner "2/5  Indeterminate (state 3, no value) for ~3s"
osc94 3
printf '  working…\n'
sleep 3
sleep 0.4

banner "3/5  Paused at 65%% (state 4) for ~2.5s"
osc94 1 65
sleep 0.2
osc94 4 65
printf '  paused at 65%%\n'
sleep 2.5

banner "4/5  Error at 42%% (state 2) for ~2.5s"
osc94 1 42
sleep 0.2
osc94 2 42
printf '  error at 42%%\n'
sleep 2.5

banner "5/5  Clear (state 0)"
osc94 0
printf '  cleared — progress bar should disappear\n\n'
