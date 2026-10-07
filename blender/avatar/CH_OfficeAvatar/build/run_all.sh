#!/bin/sh
# Rebuilds CH_OfficeAvatar from its phase scripts, in order (each one re-runnable on its own).
#   sh build/run_all.sh [first-phase]     e.g. sh build/run_all.sh 03
set -e
cd "$(dirname "$0")/.."
BLENDER=${BLENDER_BIN:-blender}
FROM=${1:-02}
for p in 02_blockout 03_forms 04_topology 05_library 06_rig 07_materials 08_anim; do
  [ "${p%%_*}" \< "$FROM" ] && continue
  echo "== $p"
  "$BLENDER" --background --python "build/$p.py" -- --master CH_OfficeAvatar_master.blend 2>&1 | grep -E "^\[|Error|Traceback" || true
done
