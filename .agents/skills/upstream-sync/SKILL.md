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

Her topology:

- **Servers:** `desktop` (Linux desktop app), `mini-server` (headless
  `t3 serve`), `shanes-macbook-pro` (laptop desktop app). Each is served at
  `https://<host>.<tailnet>.ts.net`; read the tailnet name from `tailscale status`.
- **Clients:** desktop app, laptop app, iPhone app, and Chrome on the mini, each
  paired to every server.
- **SSH:** `mini` and `mbp` set `RemoteCommand fish -l`, so pass
  `-o RemoteCommand=none -o RequestTTY=no` for one-off commands.

Gotchas from past syncs:

- A scope change leaves every existing pairing on its old grant, so settings and
  actions go read-only. Mint fresh links with
  `t3 pair --base-dir ~/.t3 --label CLIENT --ttl 1h` (its defaults are the full
  standard set), give phone links
  as QR codes (`qrencode`), and track each client × server pair in a table.
  Hard-refresh a browser client before pairing, since a cached bundle asks for the
  old scopes. Afterwards, offer `t3 auth session revoke` for old-grant sessions.
- Nix hashes differ per platform, so compare builds by grepping the dist for a
  string the merge introduced, not by store path.
- Read live state read-only (`node:sqlite` with `readOnly: true`); mint and revoke
  only through the `t3` CLI, and only once Shane asks.

## 4. Brief Shane

Brief in this order, one section at a time, and wait for her before moving on:

1. **Action needed:** the repairs from step 3, per machine.
2. **Behaviour changes:** acceptance criteria for changed defaults and anything
   with no setting, starting with what she'll hit first.
3. **New features:** what each does and how to start it.
4. **Fork impact:** seams reattached, fork features extended.

Offer a fork seam for any behaviour she might want off, and build it only once she
asks.
