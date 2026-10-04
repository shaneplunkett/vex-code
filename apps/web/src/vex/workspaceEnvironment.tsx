import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  WS_METHODS,
  type WorkspaceEnvironmentStatus,
} from "@t3tools/contracts";
import { ShieldAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ComposerBannerStackItem } from "../components/chat/ComposerBannerStack";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";

/** Web and desktop only: mobile shows the server's warning row in the thread instead. */
const workspaceEnvironmentStatus = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:workspace-environment:status",
  tag: WS_METHODS.workspaceEnvironmentStatus,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});
const allowWorkspaceEnvironment = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Allow .envrc",
  tag: WS_METHODS.workspaceEnvironmentAllow,
});
const revokeWorkspaceEnvironment = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "Revoke .envrc",
  tag: WS_METHODS.workspaceEnvironmentRevoke,
});

function useWorkspaceEnvironment(environmentId: EnvironmentId | null, cwd: string | null) {
  const query = useEnvironmentQuery(
    environmentId === null || cwd === null
      ? null
      : workspaceEnvironmentStatus({ environmentId, input: { cwd } }),
  );
  const allow = useAtomCommand(allowWorkspaceEnvironment);
  const revoke = useAtomCommand(revokeWorkspaceEnvironment);
  const [isPending, setIsPending] = useState(false);
  const { refresh } = query;
  const run = useCallback(
    (command: typeof allow) => {
      if (environmentId === null || cwd === null) return;
      setIsPending(true);
      void command({ environmentId, input: { cwd } }).finally(() => {
        setIsPending(false);
        refresh();
      });
    },
    [cwd, environmentId, refresh],
  );
  return {
    status: query.data,
    refresh,
    isPending,
    allow: useCallback(() => run(allow), [allow, run]),
    revoke: useCallback(() => run(revoke), [revoke, run]),
  };
}

function problemTitle(status: WorkspaceEnvironmentStatus): string | null {
  switch (status._tag) {
    case "inactive":
    case "ready":
      return null;
    case "blocked":
      return "This project's .envrc is blocked";
    case "failed":
      return "This project's .envrc failed to load";
    case "direnvMissing":
      return "direnv isn't installed, so this project's .envrc isn't loaded";
  }
}

/**
 * A composer banner while the thread directory's `.envrc` can't load. It only
 * exists while something is wrong; `refreshKey` re-reads the status as turns run.
 */
export function useWorkspaceEnvironmentBannerItem(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly refreshKey: unknown;
}): ComposerBannerStackItem | null {
  const environment = useWorkspaceEnvironment(input.environmentId, input.cwd);
  const { refresh } = environment;
  const { refreshKey } = input;
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(lastRefreshKey.current, refreshKey)) return;
    lastRefreshKey.current = refreshKey;
    refresh();
  }, [refresh, refreshKey]);
  const { status, isPending, allow } = environment;
  return useMemo(() => {
    if (status === null) return null;
    const title = problemTitle(status);
    if (title === null || status._tag === "inactive" || status._tag === "ready") return null;
    return {
      id: `workspace-environment:${status.envrcPath}`,
      variant: "warning",
      compact: true,
      icon: <ShieldAlertIcon />,
      title,
      description:
        status._tag === "failed"
          ? status.detail
          : status._tag === "blocked"
            ? `Turns start without ${status.envrcPath} until you allow it.`
            : status.envrcPath,
      ...(status._tag === "blocked"
        ? {
            actions: (
              <Button size="xs" variant="outline" disabled={isPending} onClick={allow}>
                Allow
              </Button>
            ),
          }
        : {}),
    };
  }, [allow, isPending, status]);
}

function WorkspaceEnvironmentRow(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly label: string | null;
}) {
  const { status, isPending, allow, revoke } = useWorkspaceEnvironment(
    props.environmentId,
    props.cwd,
  );
  if (status === null || status._tag === "inactive") return null;
  const description =
    status._tag === "ready"
      ? `Agents, terminals and scripts load ${status.envrcPath}.`
      : status._tag === "failed"
        ? status.detail
        : status._tag === "blocked"
          ? `${status.envrcPath} is blocked, so turns start without it.`
          : `${status.envrcPath} needs direnv on the server's PATH.`;
  return (
    <SettingsSection title={props.label === null ? "Environment" : `Environment on ${props.label}`}>
      <SettingsRow
        title=".envrc"
        description={description}
        control={
          status._tag === "ready" || status._tag === "failed" ? (
            <Button size="sm" variant="outline" disabled={isPending} onClick={revoke}>
              Revoke
            </Button>
          ) : status._tag === "blocked" ? (
            <Button size="sm" variant="outline" disabled={isPending} onClick={allow}>
              Allow
            </Button>
          ) : null
        }
      />
    </SettingsSection>
  );
}

/** Allow and revoke for each checkout of the project that has an `.envrc`, and nothing otherwise. */
export function WorkspaceEnvironmentSettings() {
  const { scope } = useSettingsScope();
  const members = scope.kind === "project" || scope.kind === "checkout" ? scope.members : [];
  return members.map((member) => (
    <WorkspaceEnvironmentRow
      key={member.physicalProjectKey}
      environmentId={member.environmentId}
      cwd={member.workspaceRoot}
      label={members.length > 1 ? member.environmentLabel : null}
    />
  ));
}
