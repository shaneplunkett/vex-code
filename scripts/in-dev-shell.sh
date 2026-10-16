#!/bin/sh
# Runs a command inside the flake's dev shell. Hooks can fire from places
# direnv never loaded, like an agent's shell or a GUI git client, so they
# can't count on the tools already being on PATH.
set -eu

# A shell loaded before the flake last changed can be missing a tool the
# gate needs, so trust it only if every tool is on PATH. Keep this list in
# step with the flake's packages.
current_shell_has_tools() {
  [ -n "${IN_NIX_SHELL:-}" ] || return 1
  for tool in node vp nixfmt statix deadnix; do
    command -v "$tool" >/dev/null 2>&1 || return 1
  done
}

if current_shell_has_tools; then
  exec "$@"
fi

root="$(git rev-parse --show-toplevel)"
exec nix --option warn-dirty false develop "$root" --command "$@"
