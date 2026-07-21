# Codex and Claude live trace fidelity inventory

- **Ticket:** SHA-42
- **Researched:** 2026-07-22
- **Scope:** the provider versions and adapter behaviour pinned at repository commit `9a25ae2bd`.

## Answer in one paragraph

Codex app-server exposes the cleaner trace substrate: typed thread/turn/item lifecycles, stable
thread/turn/item IDs, distinct streaming channels, explicit approval requests, cumulative and last-call
token breakdowns, first-class collaboration items, and provider timestamps/durations on turns, items,
approvals, commands, MCP calls, and dynamic tools. Claude Agent SDK exposes a richer but less uniform
stream: raw Messages API stream events and snapshots, result-level usage/cost/timings, permission
callbacks, tool results, task/subagent lifecycle and usage, compaction metadata, hook telemetry, rate
limits, retries, and several provider-specific diagnostics. Vex Code currently preserves much of either
provider's shape only inside optional `raw`/`data` payloads while its canonical fields are often
receive-time, derived, heuristically classified, flattened, or absent. A provider-neutral trace must
therefore model **provenance and confidence**, separate provider time from observation time, retain raw
payload references, make IDs and metrics optional and provider-scoped, and say `unknown` rather than
inventing equivalence (especially for active-context tokens, reasoning tokens, child-agent lineage,
approval resolution, tool status, cost, and timing).

## Sources and version boundary

This inventory uses primary sources only:

1. Vex Code's pinned Codex protocol generator records upstream Codex commit
   [`b39f943a634a6e7ba86c3d6e8cf6d5f35e612566`](../../packages/effect-codex-app-server/src/_generated/schema.gen.ts#L1-L4).
   The corresponding first-party protocol sources are the Codex
   [server request/notification registry](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/common.rs#L1388-L1436),
   [thread items](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L209-L376),
   [turns](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L182-L228), and
   [token usage](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1315-L1370).
2. Vex Code pins `@anthropic-ai/claude-agent-sdk` **0.3.170** in the
   [lockfile](../../pnpm-lock.yaml#L958-L963). The authoritative published type surface is Anthropic's
   [`sdk.d.ts` for 0.3.170](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts), and its
   first-party repository tags that release as
   [`v0.3.170`](https://github.com/anthropics/claude-agent-sdk-typescript/tree/v0.3.170).
3. “Captured by Vex” below means the runtime event contract and the current Codex/Claude adapters,
   not everything a future adapter could obtain. The shared envelope and payload algebra are in
   [`providerRuntime.ts`](../../packages/contracts/src/providerRuntime.ts#L17-L348); the implementations
   are [`CodexAdapter.ts`](../../apps/server/src/provider/Layers/CodexAdapter.ts) and
   [`ClaudeAdapter.ts`](../../apps/server/src/provider/Layers/ClaudeAdapter.ts).

The Claude package is evolving quickly, and some Codex methods are explicitly experimental or
deprecated. This is an inventory of the pinned versions, not a promise that later provider versions
will keep every shape.

## Shared Vex runtime envelope

Every canonical event can carry `eventId`, provider driver, optional provider instance, canonical
`threadId`, receive-side `createdAt`, optional canonical `turnId`/`itemId`/`requestId`, optional
provider refs, and optional raw `{source, method, messageType, payload}`. The raw source distinguishes
Codex notifications/requests from Claude SDK messages/permissions
([contract](../../packages/contracts/src/providerRuntime.ts#L17-L46),
[base fields](../../packages/contracts/src/providerRuntime.ts#L246-L263)).

The canonical algebra has session/thread/turn lifecycles; item lifecycle and content deltas; approval
and user-input lifecycles; Claude task/hook/tool telemetry; account/MCP/config diagnostics; and runtime
warning/error events. Payloads intentionally permit opaque provider data in several places
([event names](../../packages/contracts/src/providerRuntime.ts#L111-L166),
[payloads](../../packages/contracts/src/providerRuntime.ts#L265-L610)).

Two consequences matter for observability:

- canonical `createdAt` is currently generated when Vex observes/emits the event, not necessarily when
  the provider says it happened; and
- `raw` is attached only to canonical events which the adapter emits. A provider notification mapped
  to zero canonical events is not automatically retained in the canonical stream. Separate native
  NDJSON logging is optional.

## Codex: exact live surface

### Lifecycle, work and content

The app-server notification registry includes `thread/started`, status/archive/delete/unarchive/close,
name/goal/settings/token updates; `turn/started`, `turn/completed`, plan and diff updates; item
started/completed; command/file/reasoning/plan/message deltas; hook start/completion; MCP progress;
auto-approval review; warnings/errors; and realtime events
([registry](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/common.rs#L1536-L1614)).

`ThreadItem` is a tagged union with these trace-relevant exact fields:

| Item                                          | Provider fields                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `userMessage`                                 | `id`, optional `clientId`, typed content (`text`, image/local image, skill, mention)                                       |
| `agentMessage`                                | `id`, full `text`, optional response `phase`, optional memory citation                                                     |
| `plan`                                        | `id`, authoritative completed `text` (deltas need not concatenate to it)                                                   |
| `reasoning`                                   | `id`, complete `summary[]`, complete `content[]`                                                                           |
| `commandExecution`                            | `id`, command, cwd, optional process ID, source, status, parsed actions, aggregated stdout/stderr, exit code, `durationMs` |
| `fileChange`                                  | `id`, path/kind/diff changes, apply status                                                                                 |
| `mcpToolCall`                                 | `id`, server/tool, status, arguments, resource/plugin refs, result or error, `durationMs`                                  |
| `dynamicToolCall`                             | `id`, optional namespace, tool, arguments, status, output content, success, `durationMs`                                   |
| `collabAgentToolCall`                         | `id`, operation, status, sender thread, receiver thread IDs, prompt, model, reasoning effort, per-agent states/messages    |
| `subAgentActivity`                            | `id`, started/interacted/interrupted kind, agent thread ID and path                                                        |
| `webSearch` / `imageView` / `imageGeneration` | query/action; path; or generation status/revised prompt/result/saved path                                                  |
| review/compaction                             | review enter/exit text, or a context-compaction item ID                                                                    |

These fields come directly from Codex's
[`ThreadItem`](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L213-L375).
Collaboration operations are `spawnAgent`, `sendInput`, `resumeAgent`, `wait`, and `closeAgent`; target
states are pending-init, running, interrupted, completed, errored, shutdown, or not-found, with an
optional message
([definitions](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L924-L1055)).

Live content channels provide item IDs plus:

- agent-message and plan text deltas;
- reasoning summary text with `summaryIndex`, reasoning text with `contentIndex`, and summary-part
  boundaries;
- command output, terminal stdin interactions, file-change output/patch updates; and
- MCP progress text.

The precise payloads are in Codex's
[item progress notification types](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1187-L1287).

### Token usage

`thread/tokenUsage/updated` carries `threadId`, `turnId`, and:

- `total`: cumulative `totalTokens`, `inputTokens`, `cachedInputTokens`, `outputTokens`, and
  `reasoningOutputTokens`;
- `last`: the same breakdown for the latest usage interval; and
- optional `modelContextWindow`.

That is a native provider breakdown, not a cost report
([Codex token types](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1315-L1370)).

Vex maps `last.totalTokens` to canonical `usedTokens` and `total.totalTokens` to
`totalProcessedTokens`; it copies the last input/cache/output/reasoning breakdown and marks automatic
compaction true
([normaliser](../../apps/server/src/provider/Layers/CodexAdapter.ts#L160-L193)). The label
`usedTokens` is therefore a Vex interpretation of Codex's `last.totalTokens`, not a separately supplied
“active context occupancy” measurement.

### Tools and approvals

Codex has explicit server requests for command approval, file-change approval, tool user input, MCP
elicitation, additional permissions, client-executed dynamic tools, auth-token refresh, and attestation,
plus legacy patch/exec approvals
([request registry](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/common.rs#L1388-L1445)).

Command approval includes `threadId`, `turnId`, `itemId`, provider `startedAtMs`, optional distinct
`approvalId`, reason, network context, command/cwd/actions, extra permission request, proposed
exec/network policy amendments, and available decisions. File approval includes the IDs,
`startedAtMs`, reason, and optional session grant root
([request fields](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1289-L1388)).
Decisions distinguish accept, accept-for-session, policy amendment, decline, and cancel
([decision enums](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L43-L101)).

Vex's session runtime currently handles only command approval, file-change approval, and tool user
input; every other server request hits `methodNotFound`
([handlers](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts#L977-L1143)). It emits a local
resolution when Vex answers, while Codex later emits `serverRequest/resolved`, whose native payload has
only thread and request IDs, not the decision
([local decision](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1408-L1440),
[provider resolution shape](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/notification.rs#L50-L56)). A trace must not count those as two
independent approvals.

### Compaction and errors

Compaction is exposed both as the current `contextCompaction` item and the deprecated
`thread/compacted` notification. Neither compaction shape supplies before/after tokens or a duration;
nearby token updates can be correlated only as an inference
([item](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L367-L375),
[deprecated notification](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1442-L1449)).

Provider errors carry thread/turn IDs, `willRetry`, and `TurnError {message, codexErrorInfo,
additionalDetails}`
([error notification](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/notification.rs#L38-L48),
[turn error](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L219-L228)). Vex converts retrying errors to warnings and terminal ones to provider errors, preserving the
native payload in `detail`/`raw`; process stderr is separately classified with only one currently fatal
substring (`failed to connect to websocket`)
([mapping](../../apps/server/src/provider/Layers/CodexAdapter.ts#L1246-L1285)).

### Provider timing

Codex supplies substantially more event time than Vex currently promotes:

- turn `startedAt` and `completedAt` (seconds) plus `durationMs`;
- item lifecycle `startedAtMs` and `completedAtMs`;
- approval `startedAtMs` and auto-review start/completion timestamps; and
- command, MCP and dynamic-tool `durationMs`.

See the native
[turn fields](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L185-L204),
[item lifecycle timestamps](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1092-L1102), and
[completion timestamp](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1166-L1176).
Vex instead stamps the provider event at ingestion and carries native timestamps only in raw/data
payloads ([event emission](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts#L770-L809)).

## Claude: exact live surface

### Message union and content

Anthropic's `SDKMessage` union in 0.3.170 includes:

- assistant, user/replay, partial `stream_event`, and final `result` messages;
- system init/status/compact-boundary/API-retry/model-fallback/local-command/hook/plugin/task/
  thinking/session-state/notification/files/memory/elicitation/permission-denied/mirror-error messages;
- tool progress and tool-use summary;
- auth and rate-limit events; and
- prompt suggestions.

The exact union and every field are in the published
[`sdk.d.ts`](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts) under `SDKMessage` and the
individual `SDK*Message` declarations.

Assistant snapshots carry the full Anthropic `BetaMessage`, UUID, session ID, optional request ID,
parent tool-use ID, optional superseded message UUIDs, and optional subagent type/task description.
Partial messages carry the raw `BetaRawMessageStreamEvent`, UUID/session, parent tool-use ID, and
optional `ttft_ms`. User messages carry the full `MessageParam`, parent tool-use ID, optional origin,
timestamp, UUID/session, and optional subagent fields. This means the native stream can represent text,
thinking, tool-use input JSON, tool results and provider message usage without flattening them first
([published types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

Vex currently maps:

- top-level text and thinking deltas to canonical `content.delta`;
- `input_json_delta` to heuristic tool updates once partial JSON parses;
- tool/server-tool/MCP-tool block starts to tool item starts;
- user-role `tool_result` blocks to item update/completion and command/file output text; and
- completed assistant text blocks to assistant item completion.

The implementation is in the Claude
[stream-event handler](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2074-L2328) and
[tool-result handler](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2341-L2458).
It does **not** promote stream block index into canonical content, does not model redacted-thinking or
signatures as canonical content, and does not create a canonical user-message lifecycle for ordinary
user prompts. Those facts remain available only in raw/native data or the application's own submitted
turn event.

### Usage, cost and timing

Final Claude `result` messages supply:

- subtype (success or one of four error limits/execution failures), `is_error`, errors and stop reason;
- `duration_ms`, `duration_api_ms`, turn count, total cost USD;
- full `usage` (`BetaUsage`) and per-model `modelUsage`;
- permission denials and optional terminal/fast-mode state; and
- on success, optional `ttft_ms`, stream TTFT, request-start timings, warm-spare flag, API status,
  structured output, and deferred tool use.

`ModelUsage` separately provides input/output/cache-read/cache-created tokens, web-search requests,
cost USD, context window and max output tokens. These are exact fields in Anthropic's pinned
[`SDKResultMessage` and `ModelUsage` declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts).

During a turn, raw `message_delta.usage` is available. The control API `getContextUsage()` provides
active total/max tokens, percentage and category breakdowns (system prompt, tools, messages, memory,
MCP, agents, skills, attachments and more), auto-compact state/threshold, and API usage. The separate
experimental usage API exposes session cost/duration/model totals and subscription rate-limit windows
([Anthropic `Query`, `SDKControlGetContextUsageResponse`, and `SDKControlGetUsageResponse`](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

Vex queries `getContextUsage()` at turn completion when supported, otherwise derives a snapshot from
result/stream usage. It sums normal, cache-created and cache-read input tokens for its canonical input
count, and tries to distinguish active usage from cumulative processed usage
([normalisation](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L382-L520),
[turn completion](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L1881-L1970)). Canonical
`turn.completed` preserves stop reason, raw usage/model usage and cost, but drops the result timing,
turn count, permission denials, TTFT, API error status, structured output and terminal state
([emission](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2034-L2061)).

Claude also supplies elapsed tool seconds, task duration, compaction duration, approximate live
thinking-token counts, and task end/pause timing. Vex promotes tool elapsed seconds and embeds task
usage, but currently drops `thinking_tokens` and does not handle `task_updated`
([system handling](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2635-L2770),
[tool telemetry](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2797-L2827)). No Claude
provider message supplies a universal occurrence timestamp; the user-message `timestamp` is optional.
Receive time is therefore sometimes the only honest clock.

### Tools, approvals and user input

Claude tool calls are Messages API content blocks. Their native identity is tool-use ID; the start has
name/input and streaming may incrementally deliver JSON. Tool results return as user-role content and
carry `tool_use_id`, result content and `is_error`. Separately, the SDK emits `tool_progress` with
tool/parent IDs, elapsed seconds and optional task ID, plus `tool_use_summary` over preceding tool IDs
([published types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

The `canUseTool` callback exposes tool name/input, tool-use ID, abort signal and permission-update
suggestions. Its result distinguishes allow (possibly with updated input/permissions) from deny. Vex
special-cases `AskUserQuestion`, captures `ExitPlanMode`, auto-allows full-access mode, and emits
canonical request open/resolution only when it actually waits for a Vex decision
([permission implementation](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L3142-L3400)).

An auto-denial that never prompts arrives separately as `system/permission_denied` with tool name/ID,
optional subagent ID, decision-reason type/text, and returned message. Vex maps it to `tool.denied`, but
drops the reason discriminator and rejection message from canonical fields (the raw message remains on
that mapped event)
([handler](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2746-L2761)). Final result
`permission_denials[]` is not promoted. Therefore “no approval span” can mean auto-allowed,
pre-authorised, full-access bypass, or simply an unobserved decision; it must not be labelled “approved
by user”.

### Subagents and background tasks

Claude exposes two overlapping views:

1. Agent/Task tool-use blocks and messages with `parent_tool_use_id`, `subagent_type`,
   `task_description`, and message origin.
2. System task messages:
   - `task_started`: task ID, optional tool-use ID, description, subagent/task/workflow type, prompt,
     and `skip_transcript`;
   - `task_progress`: task/tool IDs, description/subagent type, `{total_tokens, tool_uses,
duration_ms}`, last tool and summary;
   - `task_notification`: terminal completed/failed/stopped status, output file, summary, optional
     usage and transcript visibility; and
   - `task_updated`: status patch, description, end time, paused time, error and background flag.

These are exact fields in Anthropic's pinned
[`SDKTask*Message` declarations](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts).

Vex emits `task.started/progress/completed`, but canonical payloads omit the tool-use correlation,
subagent/workflow metadata, prompt/output file, transcript visibility and update patches
([mapping](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2669-L2724)). It also heuristically
classifies tool names containing agent/task/subagent as `collab_agent_tool_call`
([classifier](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L606-L645)). Background assistant
messages can cause a synthetic Vex turn, which is useful for display but is not a provider-native turn
boundary ([synthetic turn](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2464-L2506)).

### Compaction, hooks and errors

Claude compaction is unusually rich. `status` says compacting/requesting/active and may report compact
success/failure. `compact_boundary` supplies trigger (`manual|auto`), pre tokens, optional post tokens
and duration, plus preserved message linkage. Vex emits a token snapshot and marks thread state
`compacted`, retaining the exact message in raw
([mapping](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2593-L2634)). This is a boundary
event, not a terminal thread state.

Hook start/progress/response messages provide hook ID/name/event, output/stdout/stderr, outcome and
optional exit code; Vex maps all three canonical phases
([mapping](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2635-L2668)). Hook callback input
types can include per-tool `duration_ms`, but that duration is not part of the emitted hook response
message and should not be assumed present in the trace.

Claude error evidence is spread across assistant `error`, `api_retry`, result error subtype/errors,
status compaction failure, `permission_denied`, task failure/update, rate-limit state, and `mirror_error`.
Vex promotes a failed result to both `runtime.error` and a failed `turn.completed`; API retries and
other unrecognised system variants become warnings with raw payload, while mirror errors become runtime
errors
([result handling](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2551-L2566),
[default system handling](../../apps/server/src/provider/Layers/ClaudeAdapter.ts#L2746-L2778)). These
are multiple observations of one failure path, not automatically separate failures.

## What Vex currently loses or changes

| Dimension        | Codex                                                                                                                                              | Claude                                                                                                                                               | Honest trace requirement                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Event time       | Native turn/item/approval timestamps and durations exist, but canonical `createdAt` is receive time                                                | No universal native timestamp; result/tool/task/compact timings are event-specific                                                                   | Store `observedAt`; optional `occurredAt`; typed durations with source/unit                                |
| Turn timing/cost | Native turn timing is left in raw; no native cost event in this surface                                                                            | Result has detailed timing and cost, but Vex drops most timing                                                                                       | Optional provider metrics; never imply Codex cost or Claude timing when absent                             |
| Token meaning    | Exact total/last input/cache/output/reasoning plus context-window limit                                                                            | Active context can come from control API; result/stream usage and per-model usage have different scopes; no equivalent billed reasoning-output field | Metric name + scope (`active_context`, `last_call`, `turn`, `session`) + source; nullable dimensions       |
| Item status      | Provider item contains command/file/MCP/dynamic/collab status; Vex marks every `item.completed` canonical status `completed`                       | Tool failure comes from `tool_result.is_error`; unfinished tools may be synthetically closed on turn end                                             | Prefer native status; record `normalised`, `derived`, or `synthetic` status provenance                     |
| Tool taxonomy    | Native tagged item kind is exact                                                                                                                   | Vex guesses kind from tool name                                                                                                                      | Keep provider tool name/kind and mark canonical category as derived                                        |
| Tool data        | Typed arguments/results/output/errors/duration are in raw/data                                                                                     | Full blocks exist; canonical text extraction can omit non-text result content                                                                        | Retain raw block/item and content modality; do not stringify away structure                                |
| Approvals        | Only command/file/user-input are handled; local and provider resolution can duplicate                                                              | Only interactive waits produce approval spans; auto-denials are separate                                                                             | Stable provider request ID, phase/source, decision actor; deduplicate observations                         |
| Subagents        | Native sender/receiver IDs and states exist; Vex suppresses child lifecycle/token/turn events and flattens remaining child events into parent turn | Native parent tool ID/task ID/message origin exist; canonical drops much correlation and invents synthetic turns                                     | Explicit optional parent span/item/task/thread links; preserve native child IDs; mark synthetic boundaries |
| Compaction       | Boundary item exists, but no before/after/duration                                                                                                 | Boundary supplies trigger/tokens/duration/preserved IDs                                                                                              | Dedicated compaction event/span; optional metrics; do not model as terminal thread state                   |
| Reasoning        | Separate exact summary/content deltas and completed arrays, with billed reasoning output tokens                                                    | Thinking text or redacted estimates; live `thinking_tokens` is explicitly approximate and Vex drops it                                               | Separate reasoning text, summary, redacted/estimate, and billed token concepts                             |
| Errors           | Retry flag and structured Codex info; stderr is separate heuristic evidence                                                                        | Errors appear in several message families and Vex can double-emit                                                                                    | Error observation ID/source/retryability; correlation and deduplication, not a flat error count            |
| Raw completeness | All notifications are registered, but unmapped ones disappear from canonical stream unless optional native logging is enabled                      | Every SDK message is optionally natively logged, but unhandled messages become warnings rather than typed events                                     | Define capture policy explicitly; raw retention cannot be inferred from canonical support                  |

The Codex child suppression/flattening behaviour is explicit in
[`shouldSuppressChildConversationNotification`](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts#L595-L637)
and the routing logic which substitutes the parent turn
([routing](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts#L841-L905)). Codex registers every
known notification, but only after this filtering
([registration](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1145-L1160)).

## Required shape for a truthful provider-neutral trace

This is a modelling recommendation, not a claim that the current contract already implements it.

1. **Keep the native observation.** Each record needs provider/instance/version, native method/type,
   native payload or durable payload reference, capture policy, and schema version.
2. **Separate clocks.** Require `observedAt`; allow `occurredAt`, `startedAt`, `endedAt`, and
   `durationMs` independently. Add `timeSource = provider | host | derived`. Never calculate latency
   from two different clocks without recording that fact.
3. **Use a graph, not only nesting.** Provider-scoped session/thread/turn/item/request/task/message IDs
   and optional `parent*` links must coexist. A child agent may have both a parent tool call and its own
   thread/turn. Preserve aliases when Vex synthesises or rewrites IDs.
4. **Record semantic provenance.** Normalised fields need `fidelity = exact | derived | heuristic |
synthetic | unknown`. This is essential for Claude tool categories, synthetic turns, Codex
   `usedTokens`, inferred compaction deltas, and terminal status.
5. **Make metric scope explicit.** A token/cost metric needs provider name, metric name, value, unit,
   scope, model when known, interval/cumulative flag, and exact/estimated flag. Missing cache,
   reasoning, cost, or context fields stay null rather than zero.
6. **Model content as typed blocks/deltas.** Preserve message/block/item identity, block index,
   modality, stream kind, completion state, and whether completed content is authoritative over deltas.
7. **Model tools and approvals separately.** A tool span may reference zero or more permission
   attempts. Permission observations need request phase, actor (`user`, policy, model classifier,
   provider, unknown), decision, persistence scope, and native reason. Provider acknowledgement is not
   another user decision.
8. **Treat compaction as a boundary.** Store trigger, before/after tokens, duration and preserved
   messages only where supplied. Do not leave a live thread permanently in a synthetic `compacted`
   state.
9. **Correlate duplicate failure evidence.** Result failure, runtime error, tool failure, retry and
   process exit should be linkable observations. Counts should be based on a chosen logical-failure
   policy, never raw event count by default.
10. **Expose coverage.** A trace/session should say whether raw native logging was enabled and which
    event families were canonicalised, retained raw-only, sampled, redacted, suppressed, or unknown.

## Bottom line for SHA-40

The provider-neutral model can offer a useful shared spine—session, thread, turn, item/tool, content,
permission, task/subagent, compaction, error and metric observations—but must not claim parity.
Codex is strongest for native lifecycle identity, structured tool items, approval requests, reasoning
breakdown and provider timestamps. Claude is strongest for result cost/timing, active-context
breakdown, background-task telemetry, compaction detail, hooks, and rich provider-specific diagnostics.
The correct observability design is therefore **canonical indexes over lossless provider evidence**, not
a lowest-common-denominator event union which silently upgrades heuristics into facts.
