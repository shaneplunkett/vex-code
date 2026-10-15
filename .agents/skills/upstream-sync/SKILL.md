---
name: upstream-sync
description: Merge a T3 Code upstream nightly into this fork and brief Shane on what changed. Use when syncing, merging, or pulling upstream, or writing release notes for a sync.
---

# Upstream sync

A sync ends with Shane knowing how her app now behaves. A clean merge with a
feature list is half the job: upstream rarely explains its UI decisions, so the
behaviour audit and the briefing carry equal weight with the merge.

## 1. Merge

1. `vp run sync:upstream --dry-run` to see the selected tag. Run it through `vp`:
   `pnpm sync:upstream` reinstalls stale dependencies first, and that install
   stops for a confirmation that fails without a terminal.
2. `vp run sync:upstream`. It merges with real ancestry, keeps the sync guards,
   and stays local-first: no push, PR, or Nix update.
3. Resolve conflicts, then `vp i`.
4. Reattach every seam `apps/server/src/vex/workspaceEnvironmentSeams.test.ts`
   reports. New providers need a direnv decision too.
5. Done when `vp check`, `vp run typecheck`, and the vex and seam tests pass.

## 2. Behaviour audit

Walk the merged range (`git log --no-merges <old-main>..<tag>`) relentlessly.
The richest sources:

- `feat` commits, and `fix`/`revert` commits that change what a user sees.
- `docs/user/` diffs, where upstream describes behaviour in user terms.
- Defaults and schema: `packages/contracts/src/settings.ts`, `auth.ts`, and
  persisted-state migrations.
- Constants that gate UI: thresholds, timeouts, provider checks.

For each user-visible change, write **acceptance criteria** read from the code,
not the PR title:

- **Shows when:** every condition, with the real numbers (`100k tokens`, `70 minutes`).
- **Looks like:** where it appears and what its states mean.
- **Does:** what each click, key, or default does, and how long a choice lasts.
- **Escape:** the setting that turns it off, or a plain "no setting", plus any
  hidden way out.
- **Why:** upstream's likely reason, labelled as a guess when it is one.

Done when every `feat` commit and every changed default, scope, or migration is
accounted for, either with acceptance criteria or as a deliberate skip.

## 3. Repair check

Find what the update breaks for Shane's machines before she does. Look hardest
at auth scopes, pairing, provider login, persisted-state migrations, and
anything that leaves old credentials or settings in a reduced state.

Her servers and clients live in `~/.config/vex-code/pairings.json`, the config
for `vp run repair:pairings`.

Gotchas from past syncs:

- A scope change leaves every existing pairing on its old grant, so settings and
  actions go read-only. Once Shane asks, `vp run repair:pairings` mints a code
  for every client × server pair and delivers them in one pass; `--status` then
  shows each server's sessions. Hard-refresh a browser client before it pairs,
  since a cached bundle asks for the old scopes. Afterwards, offer
  `t3 auth session revoke` for old-grant sessions.
- Pairing sessions expire 30 days after issue, however often they are used, so a
  re-pair resets the clock for every device at once.
- Nix hashes differ per platform, so compare builds by grepping the dist for a
  string the merge introduced, not by store path.
- Read live state read-only (`node:sqlite` with `readOnly: true`); mint and revoke
  only through the `t3` CLI, and only once Shane asks.

## 4. Nix module check

Shane's T3 config is declared in caboodle (`~/Projects/personal/caboodle`):
home-manager's `programs.t3code` in `home/shane/modules/common/vex-code.nix`,
the mini's headless server in `home/shane/modules/mini-server/vex-code.nix`, and
the package in `pkgs/vex-code/default.nix`. Every switch merges `userSettings`
into `settings.json` and `clientSettings` into `client-settings.json` with Nix
winning, so a key Nix sets resets on each switch and every other key stays
UI-owned.

Diff the server and client settings schemas over the merged range and sort
every key into:

- **Drift:** a key the module sets that was renamed, removed, retyped, moved
  between `settings.json` and `client-settings.json`, or now defaults to the
  module's value.
- **Candidate:** a new setting Shane would want identical on every machine.
- **Package:** a build change the merge needs (native deps, build steps,
  toolchain versions).

Secrets belong in the secret store and project ids differ per machine, so keep
both out of the module. Done when every key the module sets is checked against
the new schema and every new setting is sorted. Propose the edits; change
caboodle once Shane asks.

## 5. Brief Shane

Brief in this order, one section at a time, and wait for her before moving on:

1. **Action needed:** the repairs from step 3, per machine.
2. **Behaviour changes:** acceptance criteria for changed defaults and anything
   with no setting, starting with what she'll hit first.
3. **New features:** what each does and how to start it.
4. **Fork impact:** seams reattached, fork features extended.
5. **Nix module:** the drift, candidates, and package changes from step 4.

Offer a fork seam for any behaviour she might want off, and build it only once she
asks.
