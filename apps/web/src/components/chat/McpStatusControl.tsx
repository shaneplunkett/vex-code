import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderMcpServerStatus,
  ThreadId,
} from "@t3tools/contracts";
import {
  BlocksIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleOffIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { memo, useCallback } from "react";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function providerLabel(provider: ProviderDriverKind): string {
  return provider === "claudeAgent" ? "Claude" : provider === "codex" ? "Codex" : provider;
}

function statusLabel(status: ProviderMcpServerStatus["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "failed":
      return "Failed";
    case "needs-auth":
      return "Needs authentication";
    case "disabled":
      return "Disabled";
    case "unknown":
      return "Unknown";
  }
}

function StatusIcon({ status }: { readonly status: ProviderMcpServerStatus["status"] }) {
  switch (status) {
    case "connected":
      return <CircleCheckIcon className="size-3.5 text-success-foreground" aria-hidden />;
    case "connecting":
      return (
        <LoaderCircleIcon className="size-3.5 animate-spin text-info-foreground" aria-hidden />
      );
    case "failed":
      return <CircleAlertIcon className="size-3.5 text-destructive-foreground" aria-hidden />;
    case "needs-auth":
      return <KeyRoundIcon className="size-3.5 text-warning-foreground" aria-hidden />;
    case "disabled":
    case "unknown":
      return <CircleOffIcon className="size-3.5 text-muted-foreground" aria-hidden />;
  }
}

function McpServerRow({ server }: { readonly server: ProviderMcpServerStatus }) {
  const isBuiltIn = server.name === "t3-code";
  return (
    <div className="grid gap-1.5 border-t border-border/70 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <StatusIcon status={server.status} />
        <span className="min-w-0 truncate text-sm font-medium">{server.name}</span>
        {isBuiltIn ? (
          <Badge variant="secondary" size="sm">
            Built-in
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {statusLabel(server.status)}
        </span>
      </div>
      <div className="flex items-center gap-2 pl-5.5 text-xs text-muted-foreground">
        <span>{server.tools.length === 1 ? "1 tool" : `${server.tools.length} tools`}</span>
        {server.scope ? <span>· {server.scope}</span> : null}
        {server.serverInfo?.version ? <span>· v{server.serverInfo.version}</span> : null}
      </div>
      {server.error ? (
        <p className="pl-5.5 text-xs leading-4 text-destructive-foreground">{server.error}</p>
      ) : null}
    </div>
  );
}

export const McpStatusControl = memo(function McpStatusControl(props: {
  readonly compact: boolean;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly provider: ProviderDriverKind;
}) {
  const query = useEnvironmentQuery(
    props.threadId
      ? orchestrationEnvironment.mcpStatus({
          environmentId: props.environmentId,
          input: { threadId: props.threadId },
        })
      : null,
  );
  const snapshot = query.data;
  const servers = snapshot?.servers ?? [];
  const issueCount = servers.filter(
    (server) => server.status === "failed" || server.status === "needs-auth",
  ).length;
  const connectingCount = servers.filter((server) => server.status === "connecting").length;
  const providerName = providerLabel(props.provider);
  const tooltip =
    issueCount > 0
      ? `${issueCount} MCP ${issueCount === 1 ? "server needs" : "servers need"} attention`
      : snapshot?.availability === "available"
        ? `${servers.length} MCP ${servers.length === 1 ? "server" : "servers"} available to ${providerName}`
        : `View MCP servers for ${providerName}`;
  const refreshOnOpen = useCallback(
    (open: boolean) => {
      if (open && props.threadId) {
        query.refresh();
      }
    },
    [props.threadId, query],
  );

  return (
    <Popover onOpenChange={refreshOnOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label={tooltip}
            title={tooltip}
            className={cn(
              "shrink-0 gap-1.5 px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3",
              issueCount > 0 && "text-destructive-foreground hover:text-destructive-foreground",
            )}
          />
        }
      >
        {query.isPending && snapshot === null ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : issueCount > 0 ? (
          <CircleAlertIcon />
        ) : (
          <BlocksIcon />
        )}
        {props.compact ? null : <span>MCP</span>}
        {!props.compact && snapshot?.availability === "available" ? (
          <span className="text-xs tabular-nums">· {servers.length}</span>
        ) : null}
        {issueCount > 0 ? (
          <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-destructive/12 px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
            {issueCount}
          </span>
        ) : connectingCount > 0 && props.compact ? (
          <span className="size-1.5 rounded-full bg-info-foreground" aria-hidden />
        ) : null}
      </PopoverTrigger>

      <PopoverPopup side="top" align="start" className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">MCP servers</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Connections available to this {providerName} session.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label="Refresh MCP server status"
            disabled={!props.threadId || query.isPending}
            onClick={query.refresh}
          >
            <RefreshCwIcon className={cn(query.isPending && "animate-spin")} />
          </Button>
        </div>

        <div className="mt-3">
          {query.error ? (
            <div className="rounded-md bg-destructive/8 px-3 py-2 text-xs leading-4 text-destructive-foreground">
              {query.error}
            </div>
          ) : !props.threadId || snapshot?.availability === "inactive" ? (
            <p className="rounded-md bg-muted/45 px-3 py-2 text-xs leading-4 text-muted-foreground">
              MCP connections are available after this chat session starts.
            </p>
          ) : snapshot?.availability === "unsupported" ? (
            <p className="rounded-md bg-muted/45 px-3 py-2 text-xs leading-4 text-muted-foreground">
              {providerName} does not expose MCP connection status for this session.
            </p>
          ) : query.isPending && snapshot === null ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Checking MCP connections…
            </div>
          ) : snapshot?.availability === "available" && servers.length === 0 ? (
            <p className="rounded-md bg-muted/45 px-3 py-2 text-xs leading-4 text-muted-foreground">
              No MCP servers are configured for this session.
            </p>
          ) : (
            <div>
              {servers.map((server) => (
                <McpServerRow key={server.name} server={server} />
              ))}
            </div>
          )}
        </div>

        {snapshot ? (
          <p className="mt-3 text-[11px] text-muted-foreground/70">
            Checked{" "}
            {new Date(snapshot.checkedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
});
