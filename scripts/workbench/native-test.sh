#!/usr/bin/env bash
set -euo pipefail
xfwm4 --compositor=off >/tmp/rvm-native-wm.log 2>&1 &
rvm_test_wm_pid=$!
trap 'kill "$rvm_test_wm_pid" 2>/dev/null || true' EXIT
sleep 1
node scripts/workbench/native.cjs
