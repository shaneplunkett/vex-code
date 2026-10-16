#!/bin/sh
# Fails if any fork-owned file silences a checker. Agents reach for these
# under pressure, so the ban is mechanical. Upstream code keeps its own
# rules, so this only scans the Vex modules and the Nix. --untracked scans
# new files too, and still skips anything gitignored.
set -u

pattern='deadnix: *skip|@ts-ignore|@ts-nocheck|@ts-expect-error|oxlint-disable|eslint-disable|biome-ignore'

if git grep --untracked -n -E "$pattern" -- '*.nix' 'apps/*/src/vex/*' 'packages/*/src/*/vex/*' ':!.repos'; then
  echo
  echo "Suppression comments aren't allowed. Fix the finding instead."
  echo "If a rule is wrong for this case, change its config in the open and say why."
  exit 1
fi
