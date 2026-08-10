# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Fork Identity and Boundaries

This repository is **Vex Code**, Shane's personal fork of `pingdotgg/t3code`. The fork is intended to
remain easy to update while carrying a narrow Vex-owned product, branding, theme, and feature layer.

- `origin` is `shaneplunkett/vex-code` and is the only normal push target.
- `upstream` is `pingdotgg/t3code` and must remain fetch-only. Its push URL is deliberately
  `DISABLED`; do not restore a working push URL.
- Never push a branch, open a pull request or issue, or perform any other write against upstream
  unless Shane explicitly requests that exact upstream action.
- All GitHub Actions workflows are intentionally disabled for this personal fork, including CI,
  releases, relay deployment, Mobile EAS, labels, PR Size, and PR Vouch. Do not enable an existing
  workflow or add a new active workflow unless Shane explicitly requests it. Prefer the required
  local checks above and lightweight local hooks.
- Nix packaging lives in `/home/shane/nix-config`. Automated Nix input and dependency-hash updates are
  deliberately deferred until the fork is more stable; do not add them to an upstream sync or edit the
  Nix repository unless explicitly asked.

## Upstream Maintenance

`main` is the deployable Vex Code branch. Keep its history stable and merge published upstream
releases into it; do not maintain a separate upstream mirror branch.

- Prefer a published upstream nightly tag over an arbitrary `upstream/main` commit.
- Use `pnpm sync:upstream --dry-run` to inspect the selected release and `pnpm sync:upstream` to merge
  it. Use `--tag <tag>` when a particular release is required.
- The sync command must remain local-first: it may fetch, merge, install dependencies, validate, and
  create the local merge commit, but it must not push, open a pull request, or update Nix config.
- Preserve upstream ancestry with a real merge commit. Never squash an upstream sync, rebase the
  deployable fork onto upstream, or replay upstream as a patch stack.
- Do not bypass the sync command's clean-worktree, branch, or remote-history guards. Resolve any local
  divergence first.
- If a merge conflicts, keep the current upstream core behaviour and reattach Vex-specific behaviour
  through the narrowest appropriate seam. Do not resolve a broad conflict by blindly taking the whole
  `ours` or `theirs` side.
- After manually resolving an interrupted sync, rerun the task completion checks before completing the
  merge commit.

## Vex Change Architecture

The thin-fork rules in this section take precedence over the general encouragement for sweeping
maintainability changes below when work is specific to Vex Code.

- Keep Vex-only code together. Prefer `apps/web/src/vex/` for Vex product configuration, assets,
  theme overrides, components, and feature switches as that layer is introduced.
- Reuse or extend stable seams such as `apps/web/src/branding.ts`. Upstream-owned components should
  need only small imports, configuration reads, or adapter hooks into the Vex layer.
- Visible branding may change, but internal compatibility identifiers should not be renamed without a
  concrete migration requirement. Preserve names such as `T3CODE_*`, `.t3`, `t3code` URL schemes,
  persisted storage keys, protocol names, and internal package names.
- Keep generic fixes and Vex-only customisation separable. A generic improvement should remain
  upstream-compatible even when it is not being submitted upstream.
- Avoid broad formatting, mechanical renaming, folder moves, or unrelated cleanup in upstream-owned
  files. These make future merges harder without improving the fork.
- Prefer adding a Vex-owned asset or module and selecting it through configuration over replacing an
  upstream implementation in place.
- Keep each custom commit focused so the fork's delta remains understandable with
  `git diff upstream/main...main`.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

The upstream project is a VERY EARLY WIP. Sweeping changes that improve shared, upstream-compatible
architecture can be appropriate, but Vex-specific work must follow the thin-fork rules above.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.

## Runtime Safety

- Never kill processes by matching a name, path, or worktree string. The active coding agent and other
  development servers may share those strings. Stop only a PID captured at spawn, or a confirmed port
  owner after checking its working directory.
- `~/.t3/userdata` is live user data. Reading it or making a safe snapshot is allowed; never start a
  development server against it, open it read-write, clean it up, or symlink a worktree to it.
- Do not set `VITE_HTTP_URL` or `VITE_WS_URL` for development. Development is single-origin and Vite
  proxies `/api`, `/ws`, `/oauth`, and `/.well-known`; baked localhost origins break remote browsers.

## Product Surface Checklist

Before finishing user-visible or protocol work, check the applicable surfaces explicitly:

- Entry points: chat, Settings, command palette, and keybindings.
- Clients: web, desktop, and mobile; shared client logic belongs in `packages/client-runtime`.
- Providers: Codex, Claude, Cursor, Grok, and OpenCode.
- Contracts: wire changes flow through `packages/contracts` and every consumer.
- Reverse states: every action needs a way back and a visible resulting state.
- Connection modes: local, remote/relay, tunnel, multi-device, and multi-environment.
- Documentation: user behaviour in `docs/user`, architecture in `docs/internals`, and runbooks in
  `docs/operations`.

## Development Servers and Test Data

- `vp i` installs dependencies. `vp run dev` starts server and web with isolated worktree state under
  `.t3`; read the actual ports from the dev-runner output because occupied ports can shift them.
- `--share` publishes over the tailnet. Give the user the pairing URL including its token, not the bare
  origin, and do not open the shared URL yourself.
- If a pairing token is consumed, mint a fresh standard-scope token with
  `node apps/server/src/bin.ts pair`; the startup pairing URL carries admin scopes needed for
  Settings → Connections management.
- Seed isolated test data by snapshotting a real database into the worktree. Prefer SQLite
  `VACUUM INTO` while the source may be live; a plain copy is safe only when the source is stopped and
  includes its WAL and SHM siblings. Copy data into a sandbox, never back out.
- Backend async tests should wait on typed receipts and worker drains rather than sleeps or polling.

## Architecture and Taste

Clients send typed WebSocket requests. The server turns them into commands, a pure decider persists
events, and a projector builds the read model. Provider adapters translate native provider protocols;
queue-backed reactors own side effects and emit receipts. Each turn ends with a hidden Git checkpoint.

- Put provider-specific complexity at adapter boundaries; keep orchestration pure and UI components
  simple.
- Prefer inferred types and avoid `any`.
- Comments should explain how something is used, not narrate every line.
- Avoid continuously repainting animations and other work that harms high-refresh performance.
- Keep scope small and systems obvious. Do not preserve complexity merely because it already exists.
