import type {
  NodeId,
  OrchestrationV2DomainEvent,
  OrchestrationV2ConversationMessage,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  WorkspaceEnvironmentStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import {
  ProviderAdapterV2RuntimePolicy,
  type ProviderAdapterV2RuntimePolicy as RuntimePolicy,
} from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import { deriveProviderInstanceConfigMap } from "../provider/ProviderInstanceRegistryHydration.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  WorkspaceEnvironment,
  workspaceEnvironmentFingerprint,
  type WorkspaceEnvironmentDiff,
} from "./workspaceEnvironment.ts";

export interface WorkspaceEnvironmentTurnInput {
  readonly policy: RuntimePolicy;
  readonly run: OrchestrationV2Run;
  readonly message: Pick<OrchestrationV2ConversationMessage, "createdBy" | "creationSource">;
  readonly attemptId: RunAttemptId;
  readonly rootNodeId: NodeId;
  readonly providerThreadId: ProviderThreadId;
  readonly providerSessionId: ProviderSessionId;
}

export interface WorkspaceEnvironmentTurnsShape {
  /**
   * Adds the thread directory's `.envrc` environment to a turn's runtime policy. A changed
   * environment detaches the live session so it reopens with it, unless closing the session would
   * lose a wake or background work, which holds the change for a later turn. A warning row lands
   * when the `.envrc` status changes to one that keeps the environment out of the turn.
   */
  readonly prepare: (input: WorkspaceEnvironmentTurnInput) => Effect.Effect<RuntimePolicy>;
}

/**
 * Defaults to passing the policy through, so tests that build the turn start
 * service without the fork's layers keep their behaviour.
 */
export const WorkspaceEnvironmentTurns = Context.Reference<WorkspaceEnvironmentTurnsShape>(
  "t3/vex/workspaceEnvironmentTurns",
  { defaultValue: () => ({ prepare: (input) => Effect.succeed(input.policy) }) },
);

/**
 * Cursor runs inside T3's own process through an SDK with no env option, and
 * OpenCode 2 serves every directory from one shared server. Neither can take a
 * per-directory environment yet.
 */
function supportsWorkspaceEnvironment(
  driver: string,
  supportsMultipleProviderThreadsPerSession: boolean,
): boolean {
  if (driver === "cursor") return false;
  if (driver === "opencode") return !supportsMultipleProviderThreadsPerSession;
  return true;
}

const DRIVER_LABELS: Record<string, string> = { cursor: "Cursor", opencode: "OpenCode" };

function noticeFor(status: WorkspaceEnvironmentStatus, driver: string): string | undefined {
  switch (status._tag) {
    case "inactive":
      return undefined;
    case "ready":
      return `${status.envrcPath} isn't applied to ${DRIVER_LABELS[driver] ?? driver} threads yet, so this turn started without it.`;
    case "blocked":
      return `direnv has blocked ${status.envrcPath}, so this turn started without it. Allow it from the thread banner or the project's settings on web or desktop.`;
    case "failed":
      return `direnv couldn't load ${status.envrcPath}, so this turn started without it.\n${status.detail}`;
    case "direnvMissing":
      return `${status.envrcPath} wasn't loaded because direnv isn't installed on the server's PATH.`;
  }
}

function withoutNames(
  diff: WorkspaceEnvironmentDiff,
  names: ReadonlySet<string>,
): WorkspaceEnvironmentDiff {
  if (names.size === 0) return diff;
  return Object.fromEntries(Object.entries(diff).filter(([name]) => !names.has(name)));
}

const EMPTY_ENVIRONMENT: WorkspaceEnvironmentDiff = {};
const SESSION_NOTICE_SIGNAL = "workspace-environment-session";
const HELD_NOTICE =
  "The project's .envrc environment changed. This session still has work running, so it keeps its current environment until a later turn.";
const RESTARTED_NOTICE =
  "The project's .envrc environment changed, so the session restarted to load it.";

/** A provider's own wake: its turn is already running in the live process. */
function isProviderWake(message: WorkspaceEnvironmentTurnInput["message"]): boolean {
  return message.createdBy === "agent" && message.creationSource === "provider";
}

function withEnvironment(policy: RuntimePolicy, environment: WorkspaceEnvironmentDiff) {
  return Object.keys(environment).length === 0
    ? policy
    : ProviderAdapterV2RuntimePolicy.make({ ...policy, environment });
}

const make = Effect.fn("WorkspaceEnvironmentTurns.make")(function* () {
  const workspaceEnvironment = yield* WorkspaceEnvironment;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const eventSink = yield* EventSink.EventSinkV2;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  // In memory on purpose: a restart has no live sessions to refresh, and the
  // first turn after it re-posts any warning that still applies.
  const appliedEnvironments = new Map<string, WorkspaceEnvironmentDiff>();
  const postedNotices = new Map<string, string>();
  const heldFingerprints = new Map<string, string>();

  /** Names the provider instance sets explicitly, which win over the `.envrc`. */
  const explicitInstanceNames = Effect.fn("WorkspaceEnvironmentTurns.explicitInstanceNames")(
    function* (run: OrchestrationV2Run) {
      const settings = yield* serverSettings.getSettings.pipe(Effect.option);
      if (Option.isNone(settings)) return new Set<string>();
      const instance = deriveProviderInstanceConfigMap(settings.value)[run.providerInstanceId];
      return new Set((instance?.environment ?? []).map((variable) => variable.name));
    },
  );

  const postNotice = Effect.fn("WorkspaceEnvironmentTurns.postNotice")(function* (
    input: WorkspaceEnvironmentTurnInput,
    message: string,
    signal = "workspace-environment",
  ) {
    const now = yield* DateTime.now;
    const item: OrchestrationV2TurnItem = {
      id: idAllocator.derive.runSignalTurnItem({
        runId: input.run.id,
        signal,
      }),
      threadId: input.run.threadId,
      runId: input.run.id,
      nodeId: input.rootNodeId,
      providerThreadId: input.providerThreadId,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      // Ahead of everything the provider produces for this run.
      ordinal: 0,
      type: "system_notice",
      status: "completed",
      title: "Project environment",
      message,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    };
    const event: OrchestrationV2DomainEvent = {
      type: "turn-item.updated",
      payload: item,
      id: yield* idAllocator.allocate.event({ threadId: input.run.threadId }),
      threadId: input.run.threadId,
      runId: input.run.id,
      nodeId: input.rootNodeId,
      providerInstanceId: input.run.providerInstanceId,
      occurredAt: now,
    };
    yield* eventSink.writeIfRunCurrent({
      threadId: input.run.threadId,
      runId: input.run.id,
      activeAttemptId: input.attemptId,
      expectedStatus: "starting",
      events: [event],
    });
  });

  const prepare: WorkspaceEnvironmentTurnsShape["prepare"] = Effect.fn(
    "WorkspaceEnvironmentTurns.prepare",
  )(
    function* (input) {
      const { policy, run } = input;
      if (policy.cwd === null) return policy;
      const resolution = yield* workspaceEnvironment.resolve(policy.cwd);

      const adapter = yield* adapters.get(run.modelSelection.instanceId);
      const capabilities = yield* adapter.getCapabilities();
      const supported = supportsWorkspaceEnvironment(
        adapter.driver,
        capabilities.sessions.supportsMultipleProviderThreadsPerSession,
      );

      const notice =
        resolution.status._tag === "ready" && supported
          ? undefined
          : noticeFor(resolution.status, adapter.driver);
      const noticeKey = notice === undefined ? "" : `${adapter.driver}:${notice}`;
      if (postedNotices.get(run.threadId) !== noticeKey) {
        postedNotices.set(run.threadId, noticeKey);
        if (notice !== undefined) yield* postNotice(input, notice);
      }

      const environment = supported
        ? withoutNames(resolution.environment, yield* explicitInstanceNames(run))
        : {};
      const fingerprint = workspaceEnvironmentFingerprint(environment);
      const sessionKey = `${input.providerSessionId}\u0000${run.threadId}`;
      const live = yield* providerSessions.get(input.providerSessionId);
      // A session opened outside a turn start (a rollback, say) has no environment.
      const applied = appliedEnvironments.get(sessionKey) ?? EMPTY_ENVIRONMENT;
      if (Option.isSome(live)) {
        if (workspaceEnvironmentFingerprint(applied) === fingerprint) {
          heldFingerprints.delete(sessionKey);
          return withEnvironment(policy, applied);
        }
        const mustKeepSession =
          isProviderWake(input.message) ||
          (yield* live.value.hasPendingBackgroundWork ?? Effect.succeed(false));
        if (mustKeepSession) {
          if (heldFingerprints.get(sessionKey) !== fingerprint) {
            heldFingerprints.set(sessionKey, fingerprint);
            yield* postNotice(input, HELD_NOTICE, SESSION_NOTICE_SIGNAL);
          }
          return withEnvironment(policy, applied);
        }
        // The same path a worktree change takes: a session of its own closes,
        // a shared one (Codex) unloads this thread, and the open below brings
        // the conversation back with the new environment.
        yield* providerSessions.detach({
          providerSessionId: input.providerSessionId,
          threadId: run.threadId,
          detail: "The project's .envrc environment changed.",
        });
        yield* postNotice(input, RESTARTED_NOTICE, SESSION_NOTICE_SIGNAL);
      }
      heldFingerprints.delete(sessionKey);
      appliedEnvironments.set(sessionKey, environment);

      return withEnvironment(policy, environment);
    },
    // The environment is an addition to the turn. Nothing here may stop it.
    (effect, input) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not prepare the workspace environment for a turn", {
            threadId: input.run.threadId,
            cause,
          }).pipe(Effect.as(input.policy)),
        ),
      ),
  );

  return { prepare } satisfies WorkspaceEnvironmentTurnsShape;
});

export const layer = Layer.effect(WorkspaceEnvironmentTurns, make());
