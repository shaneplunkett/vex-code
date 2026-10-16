#!/bin/sh
# The gate: the one check for this repo. CI and the agents' hooks run
# exactly this, so there's one answer to "is the repo clean".
set -eu
cd "$(git rev-parse --show-toplevel)"

scripts/check-suppressions.sh

# Nix. .repos/ holds vendored references we never edit.
git ls-files --cached --others --exclude-standard -z '*.nix' ':!.repos' | xargs -0 -r nixfmt --check
statix check .
git ls-files --cached --others --exclude-standard -z '*.nix' ':!.repos' | xargs -0 -r deadnix --fail

# TypeScript, through upstream's Vite+ toolchain.
vp check
vp run typecheck
