# Canonical turn span taxonomy

- **Ticket:** SHA-44
- **Decision date:** 24 July 2026
- **Scope:** full-fidelity Codex and Claude turn traces, with a provider-neutral core
- **Version boundary:** repository provider contracts at this branch; Codex protocol commit
  `b39f943a634a6e7ba86c3d6e8cf6d5f35e612566`; Claude Agent SDK `0.3.170`; OpenTelemetry GenAI
  conventions commit `150760c6252a4bb63c49c9915bad11997d316a15`

## Decision

A Vex Code user turn has one long-lived semantic root:

```text
invoke_agent {gen_ai.agent.name}    CLIENT    vex.span.role=turn
```

It begins at the server-owned provider invocation boundary chosen by SHA-43 and ends only on accepted
terminal evidence or invocation failure. Its semantic descendants are **operations with meaningful
intervals**: observed model inference, planning, bounded reasoning, tool execution, approval or user-input
waits, background tasks, subagent invocations, timed compaction, and guarded unclassified operations.
Content chunks, progress, raw provider messages, model reroutes and checkpoints are **span events**, not
spans. These decisions were validated with Shane through the SHA-44 grilling session before the taxonomy
was finalised.

The trace has two views over the same records:

1. the default **semantic layer**, rooted visually at the turn's `invoke_agent` span, which filters
   technical rows while showing a visible count/expansion affordance wherever spans are hidden; and
2. an **all-spans layer**, which shows the unchanged browser, RPC, orchestration, provider-session,
   adapter, process, ingestion, persistence, projection and rendering hierarchy.

This preserves the standard GenAI names where a standard operation really exists and uses a small
`vex.*` vocabulary for concepts OpenTelemetry does not define. It does not fabricate a model call from
an assistant message, fabricate a duration around a point event, or flatten provider differences into
false parity. OpenTelemetry's reviewed GenAI registry is Development and uses a development schema, so
all names and mappings remain centralised behind one versioned adapter rather than being scattered
through providers ([GenAI manifest](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/model/manifest.yaml),
[GenAI overview](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/README.md)).

## Canonical tree

```text
[technical browser/RPC/orchestration ancestors, when propagated]

invoke_agent Codex | Claude Code                         CLIENT   turn
  plan Codex | Claude Code                              INTERNAL planning       [only when bounded]
    chat | generate_content {model}                     CLIENT   model_inference [only genuine calls]
  reason Codex | Claude Code                            INTERNAL reasoning      [only when bounded]
  chat | generate_content {model}                       CLIENT   model_inference [only genuine calls]
  execute_tool {tool.name}                              INTERNAL tool
    await_approval {request.type}                       INTERNAL approval
    await_user_input {request.type}                     INTERNAL user_input
    invoke_agent {agent.name}                           INTERNAL subagent        [exact causal child]
  run_task {task.type}                                  INTERNAL task
    invoke_agent {agent.name}                           INTERNAL subagent        [when task is an agent]
  compact_context                                      INTERNAL compaction      [only when timed]
  {native operation name}                               INTERNAL other           [bounded, visible gap]

  events: vex.content.*, vex.checkpoint, vex.progress,
          vex.model.rerouted, vex.provider.evidence,
          gen_ai.client.operation.exception

[technical adapter/process/ingestion/storage/projection children]
```

Indentation means known causal ownership, not merely temporal overlap. Sibling operations may overlap.
When the provider exposes a relationship but the related operation already has another parent, use a
span link. When the relationship itself is uncertain, place the span directly under the turn and retain
the candidate native IDs in raw evidence; never guess parentage from timing or “latest active item”.
OpenTelemetry defines a span as having one parent while links express additional causal relationships,
and defines events as timestamped occurrences attached to a span
([trace API: events and links](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.43.0/specification/trace/api.md#add-events),
[trace API: links](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.43.0/specification/trace/api.md#link)).

The turn remains the semantic explorer root even when a browser submit or RPC span is its trace parent.
This is a query-time presentation: stored spans keep their exact parentage and are never duplicated or
reparented. A runtime session is a replaceable provider attachment, not a semantic parent of the user
turn.

## Ubiquitous language

| Term                       | Canonical meaning                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Turn trace**             | All semantic and technical spans causally owned by one Vex user turn. One user request owns one trace even when provider child agents have their own native threads or turns.                |
| **Turn span**              | The full-lifecycle `invoke_agent` CLIENT span. It is the only required semantic span.                                                                                                        |
| **Semantic span**          | A user-meaningful operation with a defensible start, end and identity. It has `vex.span.layer=semantic`.                                                                                     |
| **Technical span**         | Transport, runtime or persistence implementation work. Vex-owned spans carry `vex.span.layer=technical`; unmarked third-party spans are also treated as technical and hidden by default.     |
| **Observation**            | One immutable fact received or produced by Vex, with an observation ID, observed time and provenance.                                                                                        |
| **Raw evidence**           | The lossless provider message/request/callback payload from which zero or more canonical facts are derived.                                                                                  |
| **Content block**          | An ordered logical block such as assistant text, reasoning, tool arguments or command stdout. Deltas and authoritative snapshots are events on its owning span.                              |
| **Task**                   | Bounded background work. It is not called a subagent unless native evidence says an agent performed it.                                                                                      |
| **Subagent**               | A distinct child agent lifecycle, usually with a native task/thread/agent identity. A tool named `Task` alone is insufficient evidence.                                                      |
| **Workspace checkpoint**   | A Vex-managed point-in-time workspace state, addressed by `CheckpointRef`, used as a pre-turn baseline or post-turn snapshot. The semantic fact is an event; Git/ref/diff work is technical. |
| **Compaction**             | A context-reduction boundary. It is a span only when a meaningful interval can be reconstructed; otherwise it is a checkpoint event.                                                         |
| **Unclassified operation** | A bounded user-meaningful operation that does not yet fit the closed taxonomy. It remains visibly labelled and produces a taxonomy-gap diagnostic until explicitly classified.               |

## Semantic role and naming matrix

`vex.span.role` is a closed core enum with one guarded `other` escape hatch. Provider-specific kinds
remain separate attributes or raw evidence; they do not silently extend the enum. Every `other` span is
visible in the semantic tree as an unclassified operation and emits a deduplicated taxonomy-gap
diagnostic so repeated native types become an explicit mapping decision rather than hidden drift.

| `vex.span.role`   | Stable span name                                 | Kind                                                                                                                   | Parent                                                                                | Create only when                                                                           | Boundary and fidelity                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turn`            | `invoke_agent {gen_ai.agent.name}`               | `CLIENT` for current external coding-agent runtimes; `INTERNAL` only for a future in-process agent                     | propagated dispatch parent or trace root                                              | always, exactly once per logical turn                                                      | start before session ensure/provider send; end at accepted terminal evidence or invocation failure. This is the standard agent client operation ([agent client span](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-agent-spans.md#invoke-agent-client-span)).                                     |
| `model_inference` | `{gen_ai.operation.name} {gen_ai.request.model}` | normally `CLIENT`; `INTERNAL` only when the actual call is in-process                                                  | nearest exact planning, reasoning, turn, subagent or task owner                       | a distinct model request and response are genuinely observable                             | use the provider/native call boundary, response ID/model and operation usage. Do not infer it from a turn, assistant message or reasoning item. The standard inference convention defines the name and kind ([inference span](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-spans.md#inference)). |
| `planning`        | `plan {gen_ai.agent.name}`                       | `INTERNAL`                                                                                                             | turn or subagent                                                                      | planning or task decomposition is reliably distinguishable and bounded                     | use item/block start and completion. Generic reasoning is not planning. OTel expressly requires that distinction and places inference under planning while resulting tools/tasks remain siblings ([plan span](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-agent-spans.md#plan-span)).           |
| `reasoning`       | `reason {gen_ai.agent.name}`                     | `INTERNAL`                                                                                                             | turn/subagent, or the actual inference if native telemetry owns it                    | the provider exposes a distinct reasoning/thinking item or block with start and end        | custom semantic span; set `vex.operation.name=reason`. If only text or a completed summary exists, record content on the turn instead of manufacturing an interval.                                                                                                                                                                                                               |
| `tool`            | `execute_tool {gen_ai.tool.name}`                | `INTERNAL`                                                                                                             | turn, subagent or task when exact; never planning merely because the plan proposed it | a real execution, not a proposed tool call or text mention                                 | one span per logical call ID/item ID, across progress and result. Use standard tool fields. Avoid duplicating MCP/native instrumentation ([execute-tool span](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-spans.md#execute-tool-span)).                                                         |
| `approval`        | `await_approval {vex.request.type}`              | `INTERNAL`                                                                                                             | related tool when exact; otherwise turn plus later link                               | an approval request is opened                                                              | start when the request becomes pending; end at the local decision, provider decision, cancellation or forced closure. Provider acknowledgement of a Vex decision is a duplicate observation, not another span.                                                                                                                                                                    |
| `user_input`      | `await_user_input {vex.request.type}`            | `INTERNAL`                                                                                                             | related tool when exact; otherwise owning turn/subagent                               | the provider explicitly pauses for non-approval input                                      | start at request, end at submitted answer/cancellation/forced closure. Do not classify every user turn as this role.                                                                                                                                                                                                                                                              |
| `task`            | `run_task {vex.task.type}`                       | `INTERNAL`                                                                                                             | related tool/subagent when exact; otherwise turn                                      | bounded provider background work is not known to be an agent                               | provider task start to completion/stopped/failure. Progress remains events.                                                                                                                                                                                                                                                                                                       |
| `subagent`        | `invoke_agent {gen_ai.agent.name}`               | `INTERNAL` for provider-internal work observed by Vex; `CLIENT` only when Vex actually makes a remote child-agent call | spawning tool/task when exact; otherwise turn plus link                               | native evidence identifies a distinct agent lifecycle                                      | retain child agent/task/thread/turn IDs. Do not mint a Vex child turn merely to complete the tree. Provider-native telemetry keeps its native kind and is linked rather than rewritten.                                                                                                                                                                                           |
| `compaction`      | `compact_context`                                | `INTERNAL`                                                                                                             | owning turn/subagent or the inference whose context was compacted, when exact         | start/end are supplied or start can be deterministically derived from an end plus duration | set `vex.operation.name=compact_context`; mark a derived start as `vex.time.start_source=derived`. A bare boundary becomes `vex.checkpoint(kind=compaction_boundary)`.                                                                                                                                                                                                            |
| `other`           | `{bounded native operation type}`                | `INTERNAL` unless an exact native span kind is reused                                                                  | nearest exact semantic owner; otherwise turn                                          | the operation is bounded and user-meaningful but no core role fits                         | require exact native type, provider/version, raw evidence and taxonomy-gap ID. Render as **Unclassified operation**, never generic task styling. It cannot be filtered from the semantic view and disappears only after an explicit versioned mapping decision.                                                                                                                   |

`invoke_workflow` is not the turn root. OTel reserves it for a reliably identifiable coordinated
workflow separate from individual agent invocations; an ordinary coding-agent turn, even one which
spawns a child, remains `invoke_agent`
([workflow span](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-agent-spans.md#invoke-workflow-span)).

Every substitution token in a span name is a stable, bounded name/type, never an ID, user prompt,
command, path, task description, error message or other unbounded content. `vex.task.type` and
`vex.request.type` come from central enums and fall back to `unknown`; task descriptions stay attributes
or content. Provider-defined tool names are permitted because `gen_ai.tool.name` is the standard naming
token, but arguments and call IDs never enter the span name. The explorer classifies spans from
`vex.span.role`, never by parsing these display names.

## Common attributes

### Required on every semantic span at creation

| Attribute                    | Rule                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vex.span.layer=semantic`    | Stable view selector. Never derive the default view from a name prefix.                                                                                                                  |
| `vex.span.state=in_progress` | Explicit live state in the active-trace record/mutation stream. The final span record changes this to `ended`; it is never inferred as provisional success.                              |
| `vex.span.role`              | One role from the matrix above.                                                                                                                                                          |
| `vex.operation.id`           | Stable canonical operation identity used for replay/idempotency. Prefer an existing canonical item/request/task ID; if Vex must mint one, persist it once and mark fidelity `synthetic`. |
| `vex.span.fidelity`          | `exact`, `derived`, `heuristic`, `synthetic`, or `unknown`. This describes semantic classification/boundary provenance, not success.                                                     |
| `vex.time.start_source`      | `provider`, `host`, `derived`, or `unknown`. Host receive time is valid but must not masquerade as provider occurrence time.                                                             |
| `gen_ai.conversation.id`     | The real Vex `ThreadId`, repeated on semantic children for direct querying. Never substitute trace ID or provider session ID.                                                            |
| `vex.turn.id`                | The owning root Vex `TurnId`, repeated on every semantic child. A provider child turn ID remains a provider alias.                                                                       |
| `vex.provider.driver.name`   | Adapter implementation such as `codex` or `claudeAgent`; distinct from `gen_ai.provider.name`.                                                                                           |

This is deliberately the complete repeated query spine; commands, paths, content, usage and
provider-native IDs remain role-specific rather than bloating every span. `vex.provider.instance.id` is
required whenever known. It is temporarily optional because the current runtime contract still permits
an absent provider instance during migration
([runtime event base](../../packages/contracts/src/providerRuntime.ts#L246-L263)). Every semantic span
also carries the role-specific standard attributes in the next section.

### Required at semantic span closure

| Attribute              | Rule                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `vex.span.state=ended` | Replaces `in_progress` only when the semantic operation closes.                                                      |
| `vex.span.outcome`     | `completed`, `failed`, `cancelled`, `interrupted`, `declined`, `abandoned`, or `unknown`. In-progress spans omit it. |
| `vex.time.end_source`  | `provider`, `host`, `derived`, or `unknown`.                                                                         |
| `error.type`           | Required only when OTel status is `Error`; use a documented low-cardinality provider code/class or `_OTHER`.         |

The turn additionally requires `vex.turn.state=completed|failed|cancelled|interrupted` and
`vex.turn.response_state=complete|partial|refused|blocked|unknown` at closure. Operation outcome and
response disposition are independent: a max-token response may be `completed + partial`, while a model
refusal may be `completed + refused`, both with OTel status unset. Preserve the exact bounded stop reason
as `vex.turn.stop_reason`. `vex.span.outcome` remains the cross-role operation result;
`vex.turn.state` is the turn-domain contract chosen by SHA-41.

### Role-specific standard and custom attributes

| Role            | Required                                                                          | Optional when exact/available                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn            | `gen_ai.operation.name=invoke_agent`, `gen_ai.provider.name`, `gen_ai.agent.name` | `gen_ai.agent.version`, `gen_ai.request.model` only for a single configured model, `gen_ai.usage.*` operation totals, `vex.turn.stop_reason`, `vex.turn.reasoning.level`, `vex.turn.cost.usd`, `vex.provider.turn.id` |
| Model inference | `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`           | `gen_ai.response.id`, `gen_ai.response.model`, `gen_ai.response.finish_reasons`, `gen_ai.request.reasoning.level`, `gen_ai.usage.*`, standard input/output content                                                    |
| Planning        | `gen_ai.operation.name=plan`, `gen_ai.agent.name`                                 | plan item/block ID and authoritative plan content events                                                                                                                                                              |
| Reasoning       | `vex.operation.name=reason`, `gen_ai.agent.name`                                  | provider item/block ID, summary/content indices, billed reasoning usage only if scoped to this operation                                                                                                              |
| Tool            | `gen_ai.operation.name=execute_tool`, `gen_ai.tool.name`, `vex.tool.kind`         | `gen_ai.tool.type`, `.description`, `.call.id`, `.call.arguments`, `.call.result`; cwd/command/exit code/duration remain typed `vex.tool.*` fields or content events                                                  |
| Approval        | `vex.operation.name=await_approval`, `vex.request.type`, `vex.request.id`         | `vex.approval.decision`, actor, persistence scope, request phase, reason, proposed permission/policy amendment, provider request ID                                                                                   |
| User input      | `vex.operation.name=await_user_input`, `vex.request.type`, `vex.request.id`       | questions, answers and provider request ID as content/events                                                                                                                                                          |
| Task            | `vex.operation.name=run_task`, `vex.task.id`, `vex.task.type`                     | description, last tool, exact usage, provider state                                                                                                                                                                   |
| Subagent        | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name`, `vex.subagent.id`      | child task/thread/turn IDs, parent tool ID, model, reasoning effort, agent type/path and scoped usage                                                                                                                 |
| Compaction      | `vex.operation.name=compact_context`                                              | trigger, before/after tokens, duration, preserved message/file IDs; `gen_ai.conversation.compacted=true` only on a real inference span                                                                                |
| Other           | `vex.operation.name`, `vex.provider.operation.type`, `vex.taxonomy.gap.id`        | provider version, native kind/name, exact parent evidence and diagnostic occurrence count; raw evidence is mandatory                                                                                                  |

OpenTelemetry's agent span does not define Vex turn IDs, routing instances, agent stop reasons, cost,
cumulative context occupancy or provider-native turn IDs. Those remain `vex.*`; no custom attribute may
be invented under `gen_ai.*`. Conversely, use the standard field whenever the meaning is exact
([GenAI agent attributes](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-agent-spans.md#invoke-agent-client-span),
[semantic-convention naming guidance](https://github.com/open-telemetry/semantic-conventions/blob/v1.43.0/docs/general/naming.md#recommendations-for-application-developers)).

Provider aliases are always explicit: `vex.provider.thread.id`, `vex.provider.turn.id`,
`vex.provider.item.id`, `vex.provider.request.id`, and `vex.provider.task.id`. They never silently replace
canonical IDs. Missing cost, cache, reasoning, duration, context or relationship data remains absent or
`unknown`, never zero or `false`.

All `gen_ai.usage.*` values are scoped to the span's operation. Standard input usage includes cached
input; cache read/creation are optional subdivisions, not extra input to add a second time. Thread
cumulative totals, active context occupancy and model context-window size remain separately scoped
`vex.thread.context.*` observations. Claude's terminal result can supply turn-scoped usage/cost; Codex's
cumulative `total` and latest-interval `last` token snapshots must not be relabelled as a whole-turn
aggregate unless correlation proves that scope. Reasoning usage belongs on the observed inference or
reasoning operation; an agent-only aggregate remains `vex.turn.usage.reasoning.output_tokens`
([GenAI usage definitions](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/registry/attributes/gen-ai.md#gen-ai-usage-input-tokens),
[Codex token usage](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1315-L1370)).

When an exact provider turn total is unavailable, Vex may calculate a clearly labelled top-level
estimate only from known non-overlapping operation scopes. Estimates never populate standard
`gen_ai.usage.*` or exact cost fields. Record them as `vex.estimate.calculated` events with value/unit,
method and method version, contributing operation IDs, coverage, model/pricing revision where relevant,
fidelity and confidence. The explorer renders **Estimated** explicitly and declines to estimate when
overlap or missing coverage makes the calculation dishonest. A later exact provider total supersedes
the displayed estimate while the estimate remains historical evidence.

`gen_ai.tool.call.arguments` follows the standard argument JSON schema.
`gen_ai.tool.call.result` is populated only for successful execution; failed/declined output remains
full-fidelity content while status/outcome/error fields describe the failure
([tool content fields](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-spans.md#execute-tool-span)).

## Fidelity and time rules

Semantic fidelity and clock fidelity are independent:

- `exact`: the provider/application explicitly identified the operation and boundary;
- `derived`: Vex deterministically mapped supplied facts, for example `start=end-duration`;
- `heuristic`: classification depends on a name/payload guess;
- `synthetic`: Vex created an identity or boundary not present in native evidence; and
- `unknown`: evidence is insufficient to classify it more strongly.

Every observation requires `observedAt`. `occurredAt`, provider start/end and provider duration are
optional and separately preserved. Event timestamps use provider occurrence time when supplied,
otherwise host observation time; `vex.event.time_source` states which. Never compute latency by
subtracting clocks with different sources. Codex supplies provider timestamps for turns, item
lifecycles and approvals, whereas Claude often exposes only duration or receive-side order
([Codex turn and item timing](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L182-L228),
[Codex item lifecycle timing](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1092-L1102),
[Claude SDK types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

A span may be canonical and useful with host-clock boundaries, but the explorer must display that
provenance. Heuristic or synthetic spans are never upgraded to exact merely because their final state
looks plausible.

## Identity, ordering and versioning

Every observation has a stable evidence/event ID plus a monotonic turn-local capture sequence. Preserve
provider-native sequences separately. Stable identity controls deduplication; capture order controls
deterministic replay. Provider occurrence time may drive chronological display when trustworthy, but it
never supplies uniqueness or total ordering. Late evidence appends at its capture sequence while retaining
its earlier provider time. Content blocks add block-local sequence and explicit supersession rules. The
explorer may expose both provider/logical chronology and actual arrival chronology when they differ.

Stamp each trace with `vex.trace.schema.version` and the pinned OTel GenAI schema revision. Enriched native
spans additionally carry `vex.mapping.revision`. Raw source observations are immutable. A newer mapping
may rebuild a versioned projection without rewriting history; retain both source and projection versions.
Changes to identity, parentage, outcome or content reconstruction require an explicit migration, and the
explorer flags versions it cannot fully interpret rather than assuming current semantics.

## Lifecycle, outcome and error semantics

OTel status and domain outcome answer different questions. Successful instrumentation leaves status
**unset**; Vex must not set `OK` for ordinary success. In the OTel status ordering, `OK` overrides prior
or future `Error` and analysis tools may use it to suppress errors, so reserve it for an explicit
application/operator override. Set status `Error`, `error.type` and a predictable useful description
only when that span's operation failed. This follows the core error rules
([recording errors](https://github.com/open-telemetry/semantic-conventions/blob/v1.43.0/docs/general/recording-errors.md),
[trace status API](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.43.0/specification/trace/api.md#set-status)).

| Situation                                                         | `vex.span.outcome` / turn state                                    | OTel status                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Operation completes normally                                      | `completed`                                                        | unset                                                                                         |
| Approval returns deny                                             | approval `completed`; related tool may be `declined`               | unset on both                                                                                 |
| Expected user cancellation                                        | `cancelled`; turn `cancelled` when terminal                        | unset unless caller contract treats it as failure                                             |
| Provider reports interrupted but recoverable work later completes | attempt may be `interrupted`; logical turn eventually `completed`  | recovered logical turn unset; failed technical attempt may be `Error`                         |
| Tool/task/subagent fails but the agent handles it                 | child `failed`, turn may still `completed`                         | child `Error`; turn unset                                                                     |
| Terminal provider/runtime/transport failure                       | `failed`; turn `failed`                                            | `Error` with `error.type`                                                                     |
| Parent terminates before child has terminal evidence              | child `abandoned` or `unknown` with forced-closure reason          | `Error` only when abnormal loss made that operation fail; expected cancellation remains unset |
| Refusal, safety block, max-token stop or truncated output         | `completed` plus `refused`, `blocked`, or `partial` response state | unset unless provider says the operation failed                                               |

While open, every semantic operation is `in_progress`. An optional bounded `vex.span.phase` adds
secondary detail such as `executing`, `streaming`, `waiting_approval`, `waiting_user_input`, or
`retrying`; phase changes are live mutations/events, never outcomes or extra spans. The explorer
therefore shows **In progress** as the primary state and, for example, **Waiting for approval** as its
phase. The active-trace journal carries this state because ordinary OTel export persists ended spans.

A retry observation does not end the logical span. Stable logical-call identity decides whether a retry
is a new semantic operation: retries of the same logical tool call remain one semantic tool span with
technical attempt children; a later agent-issued call with a new call ID is a new semantic tool span.
Record attempt-level failures as technical child spans or evidence events and close the semantic
operation once. The standard
`gen_ai.client.operation.exception` event is recorded once for a real client-operation exception, not
for every duplicate warning/result/process symptom
([GenAI exception event](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-exceptions.md)).

Correlate duplicate failure-shaped evidence into one logical semantic failure only when stable IDs and
exact relationships support it. Failed result, runtime error, retry notice, warning, stderr and process
exit remain separate raw observations, while semantic error counts count the logical failure. If
correlation is uncertain, keep the observations separate and label them uncorrelated rather than
guessing.

A terminal parent turn may have an `in_progress` background task or proven subagent child. End the parent
on real terminal evidence, keep the overall trace active while any semantic descendant remains open, and
show **Completed — background work in progress**. A later turn affected by that child links to it; the
original parent is not held open to distort response latency.

Forced closure, late evidence, process restart and linked continuation policy belong to SHA-46, but any
implementation must preserve the outcomes above and must never silently close an incomplete span as
successful.

## Content and event model

### Decision: full content lives inside canonical trace records

SHA-40 explicitly opts this product into full-fidelity capture: retained traces include prompts,
responses, reasoning, tool inputs/results and command output; configuring OTLP exports the same content
after disclosure. Therefore the canonical trace record stores content bodies, not merely external
references. This is a deliberate opt-in to OpenTelemetry's full buffered content mode; OTel warns that
such data is large and sensitive and permits JSON serialisation where structured span attributes are
unavailable
([GenAI content guidance](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-spans.md#capturing-instructions-inputs-and-outputs)).
Payload limits and chunking are deferred to SHA-49, but that work may not discard bytes silently.

Canonical content is recorded as events because events carry their own timestamps/order and avoid one
span per stream delta. Final standard attributes (`gen_ai.system_instructions`,
`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.tool.call.arguments` and
`gen_ai.tool.call.result`) are also populated when the complete content is known and losslessly fits the
standard JSON schema. They are interoperability projections; canonical content events plus raw evidence
remain sufficient to rebuild the full view.

### Content event names

| Event                         | Meaning                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vex.content.block.started`   | A provider/application identified a new logical content block. Optional when the first delta/snapshot already establishes it.                                                                                      |
| `vex.content.delta`           | One exact streamed addition. Preserve provider delta boundaries and order. Batching may only wrap multiple ordered deltas without losing their individual IDs, sequence or timestamps.                             |
| `vex.content.snapshot`        | A full block/message snapshot observed before terminal completion. It does not erase earlier deltas.                                                                                                               |
| `vex.content.block.completed` | The block ended. Include the provider's completed content when supplied and mark whether it is authoritative.                                                                                                      |
| `vex.content.omitted`         | Explicit evidence that content existed but was unavailable, unsupported or deliberately removed. Requires a reason and known byte/block counts where available. It is not permitted for ordinary SHA-40 retention. |

Every content event requires:

- `vex.event.id` and monotonic `vex.event.sequence` within the owning turn;
- `vex.content.block.id` and monotonic `vex.content.sequence` within the block;
- `vex.content.role`;
- `vex.content.modality=text|json|image|audio|binary|unknown`;
- `vex.content.encoding=utf8|json|base64` when a body is present;
- `vex.content.body` for delta/snapshot/completed content, encoded losslessly;
- `vex.content.fidelity=exact|derived|heuristic|synthetic|unknown`;
- `vex.event.observed_at` and `vex.event.time_source`; and
- the source evidence ID when derived from raw provider evidence.

Optional exact fields include provider block/content/summary index, message UUID, response/request ID,
parent tool-use ID, native role/type, MIME type and byte count. An authoritative completed snapshot
requires `vex.content.authoritative=true` and `vex.content.supersedes_through_sequence`; when replacing a
prior snapshot it also records `vex.content.supersedes_event_id`. The latest valid explicit supersession
chain determines the final rendered value. Superseded deltas/snapshots remain labelled historical
evidence and are never deleted. With no authoritative snapshot, reconstruct from ordered deltas and
label the result `derived`; conflicting or incomplete supersession remains visibly ambiguous rather than
being silently resolved. Codex explicitly supplies completed arrays/text alongside indexed deltas, and
Claude supplies full assistant/user messages alongside raw stream events
([Codex thread items and progress](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L209-L376),
[Claude SDK message union](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

The closed core content roles are:

```text
system_instruction     user_message          assistant_message
reasoning              reasoning_summary     plan
approval_prompt        approval_response     user_input_prompt
user_input_response    tool_arguments        tool_result
command_stdout         command_stderr        file_change
diff                   review                compaction_summary
image                   audio                 unknown
```

Role is semantic; modality is representation. JSON tool arguments are `tool_arguments/json`, an image
inside a user prompt is `user_message/image`, and redacted/opaque provider thinking remains exact raw
evidence with canonical role `unknown` unless its meaning is explicit.

### Event ownership

- system instructions, the submitted user prompt and ordinary assistant output belong to the turn, or
  to a genuine inference span when that span directly owns them;
- plan content belongs to the planning span, otherwise the turn;
- reasoning text/summary belongs to the reasoning span, otherwise the actual inference or turn;
- tool arguments/results/stdout/stderr/file changes belong to the tool span;
- approval and user-input prompts/responses belong to their wait spans;
- task/subagent messages belong to that task/subagent when identity is exact; and
- ambiguous content stays on the turn with native IDs and fidelity rather than being attached to a
  guessed active child.

An event may only be added to an active span. If its semantic owner has already ended, retain that
owner's span context and put the event on a short technical carrier span in the same trace, parented or
linked to the ended owner. The semantic explorer projects the event back onto the owner by
`vex.operation.id`; it does not mutate an ended span or invent a zero-duration semantic span. This is
the required path for post-turn workspace checkpoint results and late provider evidence. SHA-46 decides
how this carrier behaves across a server restart.

### Raw evidence event

Every native provider message/request/callback is retained exactly once as `vex.provider.evidence` on
the nearest active semantic owner, falling back to a technical evidence carrier linked to the turn. A
replay with the same stable evidence identity is idempotent and produces no second event. Required fields
are evidence/event ID,
provider/instance/version, native source and method/message type, observation time, native IDs, capture
policy, schema version and lossless payload JSON/base64. Canonical spans/content events reference that
evidence ID. A native message mapped to no semantic event is still retained.

This is stricter than today's canonical stream: the shared envelope can carry `raw`, but only on events
an adapter emits, so unmapped native notifications can disappear without the separate raw tap
([runtime raw envelope](../../packages/contracts/src/providerRuntime.ts#L17-L46),
[event algebra](../../packages/contracts/src/providerRuntime.ts#L111-L166)). Raw evidence is not another
span and does not independently open or close semantic operations.

### Other semantic events

| Event                               | Required payload                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vex.progress`                      | event/operation ID, turn-global sequence, bounded progress kind, observed time/time source, fidelity; optional exact elapsed duration, task/tool state, usage and evidence ID. Progress never changes terminal outcome by itself. |
| `vex.model.rerouted`                | exact requested/from model, resolved/to model, bounded reason, event ID/sequence, fidelity and evidence ID. If a genuine inference span exists, its standard request/response model fields remain authoritative for that call.    |
| `gen_ai.client.operation.exception` | standard exception type/message/stack fields for one real GenAI client-operation exception; duplicate warning/result/process symptoms refer to the same logical failure instead of repeating it.                                  |
| `vex.files.persisted`               | event/operation ID, owning turn, exact provider file/item IDs, observed time/time source, fidelity and evidence ID. It is not a Vex workspace checkpoint.                                                                         |
| `vex.turn.continuation.started`     | event/operation ID, owning logical turn, previous trace/span context, new continuation span context, reason, observed time/time source and fidelity. SHA-46 fixes its restart lifecycle.                                          |
| `vex.taxonomy.unclassified`         | taxonomy-gap ID, owning operation/turn, provider/version, native operation type, evidence ID and mapping revision. Deduplicate diagnostics by provider/version/native type but keep every trace occurrence visible.               |

### Checkpoints are events, not spans

Record `vex.checkpoint` on the active turn or on a short technical checkpoint-capture span linked to
the turn when the result arrives after turn closure. The event requires:

- required `vex.checkpoint.kind`, owning thread/turn, `vex.event.id`, sequence, observed time/time source
  and fidelity;
- `vex.checkpoint.ref` and `vex.checkpoint.status` for workspace kinds;
- optional baseline/previous checkpoint ref, file count, additions/deletions, related operation ID and
  evidence ID; and
- content as separate content events, not an untyped blob inside the checkpoint.

The closed core kinds are `workspace_baseline`, `workspace_snapshot`, `compaction_boundary`, and
`recovery_boundary`. Do not relabel plan completion, review mode, persisted-file notices, turn bounds or
continuation as checkpoints: they already have content, operation or dedicated event semantics. Model
reroute is `vex.model.rerouted`; provider file persistence is `vex.files.persisted`; tool/task progress
is `vex.progress`; continuation is `vex.turn.continuation.started`.

A checkpoint is instantaneous. Vex's actual `captureCheckpoint`/diff operation is a bounded technical
storage span and carries `vex.checkpoint` when it knows the resulting ref and status. The normal
post-turn capture is causally a child of the turn even though it may start or end after the turn span;
the carrier retains the ended turn as its causal parent or link. This follows the event model, preserves
the real I/O duration, and avoids a fake zero-duration semantic operation
([current checkpoint reactor](../../apps/server/src/orchestration/Layers/CheckpointReactor.ts#L225-L311)).

## Approvals and user input

Approvals are separate from tools because they answer a different question: whether execution may
proceed. One tool may have zero, one or several approval attempts. An approval span requires request
phase/source, decision actor (`user`, `policy`, `model_classifier`, `provider`, `unknown`), decision,
persistence scope and native reason when supplied.

Canonical decisions are:

```text
allow | allow_session | allow_with_amendment | deny | cancel | unknown
```

The exact native value is retained separately. Codex distinguishes accept, accept-for-session, policy
amendment, decline and cancel and supplies separate command/file request identities and timestamps
([Codex approval fields and decisions](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L43-L101),
[Codex approval requests](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1289-L1388)).
Claude's `canUseTool` result distinguishes allow (possibly with updated input/permissions) from deny
and supplies tool-use identity and permission suggestions
([Claude SDK types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

A local Vex response followed by provider `request/resolved` is one approval with two observations.
Deduplicate by provider request/tool/item ID and phase; do not count the provider acknowledgement as a
second user decision. A denied approval completes the approval operation normally and generally makes
the related tool `declined`; neither is an OTel error. Failure to deliver or apply the decision is an
operational error and is represented separately.

Provider requests for factual/user choices use `user_input`, not `approval`. Auth refresh, attestation
or MCP elicitation may use the closest exact role only when the product actually supports and bounds
it; otherwise retain raw evidence and, if it is a bounded user-meaningful operation, surface guarded
`other` with a taxonomy-gap diagnostic rather than pretending a completed known interaction.

## Subagents and tasks

A subagent needs explicit native evidence: agent/subagent type, child thread/agent identity,
`parent_tool_use_id`, collaboration receiver ID, or another provider-owned relation. A background task
without that evidence is `task`. This prevents a provider-neutral UI from presenting all asynchronous
work as child agents.

For an exact spawn relation, nest the subagent beneath the spawning collaboration/Task tool. If a task
owns the child lifecycle, nest it under the task. If the child is known but its parent is not, make it a
direct turn child and add a link to any related span; never use temporal overlap as parentage.

Codex exposes collaboration operations, sender/receiver thread IDs and agent states, but the current
Vex runtime suppresses child lifecycle/token/turn notifications and flattens remaining child events
onto the parent turn. Full-fidelity capture must move those observations into raw evidence and rebuild
explicit optional lineage rather than perpetuating the flattening
([Codex collaboration item](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L924-L1055),
[current child routing](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts#L595-L637)).

Claude assistant/user/stream messages carry `parent_tool_use_id` and optional subagent/task metadata;
its task events supply task IDs, status, duration and usage. Use those independently: a task usage
record does not become root turn usage, and approximate thinking tokens do not become billed reasoning
tokens
([Claude SDK types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

## Compaction

Compaction is not a terminal thread state. It is a context boundary inside a continuing turn/thread.

- Codex's `contextCompaction` item and deprecated compacted notification supply a boundary but no
  before/after counts or duration. Record a `compaction_boundary` checkpoint and
  `vex.turn.conversation.compacted=true`; do not fabricate a span
  ([Codex compaction shapes](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L367-L375)).
- Claude's compact-boundary metadata can supply trigger, pre-compaction tokens, duration and preserved
  file IDs. Create `compact_context` ending at the boundary, derive its start only from that duration,
  and mark the start clock/overall fidelity derived
  ([Claude SDK types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).
- Record `gen_ai.conversation.compacted=true` on a genuine inference span when it describes that model
  input. At the agent-only boundary use the positive-only Vex attribute; absence means unknown, never
  false
  ([GenAI compaction attribute](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/registry/attributes/gen-ai.md#gen-ai-conversation-compacted)).

Nearby token snapshots may be linked as observations but do not become exact before/after counts.

## Technical all-spans layer

Technical spans keep their native semantic conventions and names where those exist. Otherwise use
low-cardinality operation names and `vex.span.layer=technical`; do not force them into
`vex.span.role`. Third-party/native spans which cannot be classified exactly remain unmodified and are
treated as technical by default because only explicit `vex.span.layer=semantic` records enter the
semantic span tree.

| `vex.technical.role`  | Examples                                            | Parent/link rule                                                                                   |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `browser`             | `turn.submit`, render interaction                   | actual user/RPC context; ends at dispatch acknowledgement                                          |
| `rpc` / `transport`   | Effect RPC CLIENT/SERVER, WebSocket send/receive    | normal distributed parentage; reconnect/replay never owns turn lifetime                            |
| `orchestration`       | command persist, queue wait, command consume        | propagate or link by stable command ID                                                             |
| `provider_session`    | ensure, start, recover, replace                     | child of turn when done for that turn; session replacement does not replace root                   |
| `provider_adapter`    | send-turn request/ack, interrupt, approval response | short child operation; acknowledgement does not close turn                                         |
| `provider_process`    | native Codex/Claude spans, stdio/JSON-RPC           | propagate W3C context where supported; otherwise link using provider IDs                           |
| `ingestion`           | event decode/correlate/normalise                    | re-enter active turn context; does not create semantic duplicates                                  |
| `hook`                | Claude/Codex hook execution                         | technical unless the hook itself is a user-visible tool                                            |
| `storage`             | trace/evidence append, flush, retention             | child/link to the operation being stored; failures may be errors without changing provider outcome |
| `projection`          | trace index/read-model update                       | rebuildable technical work, never source of semantic truth                                         |
| `delivery` / `render` | subscription, reconnect replay, UI render           | link to turn; never a lifecycle owner                                                              |

Retries and attempts live here. A failed adapter attempt may be `Error` while the logical turn succeeds.
Do not duplicate native MCP, HTTP or provider spans with a second synthetic technical span. If a native
span exactly satisfies a semantic role, enrich and reuse its stored record with Vex role/owner/fidelity
attributes, original span ID and mapping revision; preserve every native attribute. An uncertain match
stays technical and emits the taxonomy gap instead of receiving a wrapper.

The semantic view filters technical rows but shows a **N technical spans hidden** affordance on the
relevant edge/operation. Selecting it expands those spans in context; matching a hidden span in search
reveals its technical path automatically. All-spans mode preserves the complete original hierarchy.
This is query-time presentation only: storage never reparents or duplicates spans.

## Provider examples

### Codex turn

```text
invoke_agent Codex                                      CLIENT turn
  gen_ai.provider.name=openai
  gen_ai.conversation.id=<Vex ThreadId>
  vex.turn.id=<Vex TurnId>
  vex.span.fidelity=exact
  vex.span.state=in_progress
  events:
    vex.content.snapshot(role=user_message, body=<full submitted input>)

  reason Codex                                          INTERNAL reasoning
    events:
      vex.content.delta(role=reasoning_summary, summary_index=0, ...)
      vex.content.block.completed(authoritative=true, ...)

  plan Codex                                            INTERNAL planning
    gen_ai.operation.name=plan
    events:
      vex.content.delta(role=plan, ...)
      vex.content.block.completed(role=plan, authoritative=true, ...)

  execute_tool shell                                    INTERNAL tool
    gen_ai.tool.call.id=<item id>
    vex.tool.kind=command_execution
    events: vex.content.snapshot(role=tool_arguments, body=<command/cwd>)

    await_approval command_execution_approval            INTERNAL approval
      vex.approval.decision=allow_session

    events:
      vex.content.delta(role=command_stdout, ...)
      vex.content.block.completed(role=tool_result, ...)

  execute_tool spawn_agent                              INTERNAL tool
    invoke_agent Codex                                  INTERNAL subagent
      vex.subagent.id=<receiver thread id>
      <child messages/tools if the raw tap observes them>

  event: vex.checkpoint(kind=compaction_boundary)
  event: vex.provider.evidence(<each native message once>)

  root closure:
    vex.span.state=ended
    vex.span.outcome=completed
    vex.turn.response_state=complete

capture_workspace_checkpoint                              INTERNAL technical/storage
  parent/link=<ended turn context>
  event: vex.checkpoint(kind=workspace_snapshot, ref=<CheckpointRef>, status=ready)
```

There is no Codex model-inference span in this example. Reasoning, plan and assistant items do not prove
how many underlying OpenAI requests occurred. Codex supplies exact item types/IDs/statuses, indexed
content deltas, command/MCP durations, collaboration relations and token breakdowns, so those are
retained without upgrading them into unseen model calls
([Codex item union](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L209-L376),
[token usage](https://github.com/openai/codex/blob/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1315-L1370)).

### Claude Code turn

```text
invoke_agent Claude Code                                CLIENT turn
  gen_ai.provider.name=anthropic
  gen_ai.conversation.id=<Vex ThreadId>
  vex.turn.id=<Vex TurnId>
  vex.span.state=in_progress
  events:
    vex.content.snapshot(role=user_message, body=<full submitted input>)
    vex.content.delta(role=assistant_message|reasoning, block_index=..., ...)

  execute_tool Bash                                     INTERNAL tool
    gen_ai.tool.call.id=<tool_use_id>
    events: vex.content.snapshot(role=tool_arguments, modality=json, ...)

    await_approval command_execution_approval            INTERNAL approval
      vex.approval.decision=allow

    events:
      vex.progress(elapsed_seconds=...)
      vex.content.block.completed(role=tool_result, ...)

  execute_tool Task                                     INTERNAL tool
    invoke_agent Claude Code                            INTERNAL subagent
      vex.subagent.id=<task/agent identity>
      events: child assistant/tool content with parent_tool_use_id

  run_task background_job                              INTERNAL task
    vex.span.state=in_progress
    events: vex.progress(...)

  compact_context                                      INTERNAL compaction
    vex.time.start_source=derived
    vex.compaction.trigger=auto
    vex.compaction.before_tokens=<provider pre_tokens>
    vex.compaction.preserved_file_ids=<native IDs>

  root closure:
    vex.span.state=ended
    vex.span.outcome=completed
    vex.turn.response_state=complete
    gen_ai.usage.*=<result-scoped exact counts>
    vex.turn.cost.usd=<provider result total>
    vex.turn.stop_reason=<agent result stop reason>
    trace state=active while background_job remains in_progress
```

Claude `stream_event` and assistant snapshots make full content and block order visible, but a Messages
API-shaped message observed through Claude Code is not automatically a Vex-instrumented Anthropic
CLIENT call. Create a model-inference span only if native/provider instrumentation exposes the actual
request boundary and correlation. Result-level cost/timing/usage belongs on the root; per-task/model
usage stays scoped to the corresponding operation
([Claude SDK result, message, task and compaction types](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)).

## Invariants

1. Exactly one semantic `turn` span exists per logical Vex turn; duplicate dispatch/replay returns the
   existing capture.
2. `sendTurn` acknowledgement, browser disconnect, subscription replay and provider-session replacement
   never close the turn.
3. Every semantic span has a stable operation ID, owning Vex turn/thread, provider provenance, semantic
   fidelity and independent clock provenance.
4. Parentage uses exact causal IDs. Uncertain relations use a root child plus link/raw evidence, never
   timing guesses.
5. A model-inference span requires a distinct observed call. A planning span requires distinguishable
   planning. A reasoning span requires a bounded reasoning item/block.
6. One logical tool call produces one tool span. Progress, streamed output, retries and duplicate result
   observations do not create additional semantic tool spans.
7. Approval/user-input spans are independent of tool outcome and deduplicate local decisions from
   provider acknowledgements.
8. Tasks become subagents only with agent evidence. Child provider IDs are not silently rewritten as Vex
   turn IDs.
9. Content deltas, snapshots, progress, raw evidence, reroutes and checkpoints are events, not
   semantic spans. A late event uses a child/linked technical carrier and remains projectable onto its
   semantic owner.
10. Every native provider observation is retained exactly once even when no canonical mapping exists.
11. Final authoritative content never deletes delta chronology; reconstruction rules are deterministic.
12. Full content bytes live in trace records. Omission, truncation, redaction or unsupported capture is
    explicit and measurable, never silent.
13. OTel status remains unset on success/decline/expected cancellation and is `Error` only for a failed
    operation; terminal errors require `error.type`.
14. Missing provider facts stay absent/unknown. Counts and booleans are never defaulted to zero/false.
15. Semantic and technical layers share one trace but are independently selectable. Native spans are not
    duplicated or renamed merely to fit the Vex view.
16. All derived views and indexes can be rebuilt from completed/incomplete canonical trace records and
    their events; provider event logs or UI state are not hidden sources of truth.
17. An open semantic span is explicitly `in_progress` with optional phase and no outcome. Closure changes
    it to `ended` plus one outcome. A completed parent may retain an in-progress background child, keeping
    the trace active.
18. Turn outcome and response state are independent; partial, refused and blocked responses remain visible
    without becoming instrumentation errors.
19. Exact scoped usage/cost wins. Any top-level estimate is labelled, provenance-backed, kept out of
    standard exact fields and suppressed when overlap or coverage makes it dishonest.
20. A bounded unclassified operation is a visible `other` span with a taxonomy-gap diagnostic; it is never
    silently hidden, styled as a known role, or left raw-only.
21. Exact native semantic spans are enriched and reused with their original identity, never wrapped or
    double-counted.
22. Semantic filtering preserves exact stored parentage, exposes hidden technical-span counts and permits
    in-context expansion or complete all-spans display.
23. Stable IDs plus capture sequence control deduplication and replay. Timestamps alone never establish
    identity, total order or parentage.
24. Raw records, taxonomy and mapping revisions are versioned; projections may be rebuilt without
    rewriting source history.

## Rejected alternatives

| Alternative                                                            | Why rejected                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Span per canonical/provider event or text delta                        | Events are occurrences, not operations; this produces noise, false durations and an unusable tree.                                             |
| Make every item a span                                                 | Messages and unbounded content are data. Only bounded planning/reasoning/tool/etc. operations qualify.                                         |
| Fabricate `chat {model}` from assistant/reasoning messages             | One agent turn or message may hide multiple calls, retries or model reroutes. The result would claim unsupported latency, usage and parentage. |
| Use `invoke_workflow` as the root                                      | An ordinary coding-agent invocation is not a separately identified workflow under the OTel convention.                                         |
| Put approvals inside tool status only                                  | It loses wait duration, actor, persistence and repeated-attempt semantics and conflates denial with execution failure.                         |
| Call every task a subagent                                             | Claude and future providers expose non-agent background tasks; tool names and timing are insufficient evidence.                                |
| Force every child under the latest active tool                         | Concurrent work and late events make temporal nesting false. Exact IDs or links are required.                                                  |
| Represent a compaction/checkpoint as a zero-duration span              | A boundary is a point event. A compaction span exists only when there is a defensible interval.                                                |
| Treat `thread.state=compacted` as durable truth                        | Compaction is a boundary in a continuing thread, not a permanent terminal state.                                                               |
| Use one lowest-common-denominator provider tree                        | It would discard Codex collaboration/timing and Claude cost/task/compaction detail or falsely claim parity.                                    |
| Store only standard final GenAI content attributes                     | They lose stream chronology, reasoning/plan/provider-specific blocks and raw unsupported messages.                                             |
| Store only external content references                                 | SHA-40 requires trace records to be the rebuildable source of truth and export the same full fidelity.                                         |
| Mark successful spans `OK`                                             | OTel instrumentation should leave success unset; `OK` can suppress later errors.                                                               |
| Put browser/RPC/storage spans in the default tree                      | It buries the user-meaningful turn. Filter them with a visible hidden count and retain in-context/all-spans expansion.                         |
| Hide unclassified bounded work as raw-only                             | It conceals taxonomy gaps. Guarded `other` stays visible and produces a diagnostic until explicitly mapped.                                    |
| Wrap an exact native span in a second canonical span                   | It duplicates operation duration, usage, failures and counts. Enrich and reuse the original record instead.                                    |
| Order or deduplicate only by provider timestamp                        | Multiple clocks, collisions, late evidence and replay make timestamps insufficient; stable IDs and capture sequence are required.              |
| Put estimated totals in standard exact usage/cost fields               | It disguises inference as provider truth. Estimates require separate labelled fields/events and complete provenance.                           |
| Treat refusal or truncation as an instrumentation error                | Operation outcome and response disposition are different; preserve `refused`, `blocked` or `partial` separately.                               |
| Put Vex UI concepts or provider switches in the generic capture module | It widens the fork delta and couples upstream-compatible capture to one branded presentation.                                                  |

## Implementation handoff

### Generic core

Implement the taxonomy inside the server-owned Turn Trace Capture module selected by SHA-43:

1. one versioned constants/schema module for role, layer, live state, phase, outcome, response state,
   fidelity, time source, checkpoint, content-role and event-name enums plus the pinned OTel mapping;
2. one active-span registry keyed first by command/turn and then by provider turn/item/request/task
   aliases;
3. role-specific state machines for tool, planning, reasoning, approval, user input, task, subagent,
   compaction and guarded `other` spans;
4. one content/evidence recorder which assigns stable event/block IDs and capture/block sequences,
   applies explicit supersession, preserves full payloads, and attaches them to the nearest exact owner;
5. one native-span enrichment path which preserves original identity/attributes and stamps the mapping
   revision instead of wrapping exact provider spans;
6. one logical-failure correlator, scoped usage/cost model and conservative top-level estimate calculator;
7. one guarded-unclassified diagnostic path keyed by provider/version/native type;
8. one OTel sink and one live mutation stream driven by the same state machine; and
9. technical instrumentation hooks which preserve existing standard/native spans without producing
   semantic duplicates.

Keep `packages/contracts` schema-only. The existing provider event contract is an input compatibility
surface, not the finished trace taxonomy. Provider adapters report facts they uniquely own; they do not
construct explorer nodes or know OTel naming rules. The generic capture/state/index/query contracts stay
upstream-compatible.

### Thin-fork placement

Vex-only retention/export disclosure, feature enablement and semantic explorer presentation live behind
narrow adapters. Put Vex web UI/configuration under `apps/web/src/vex/` and limit upstream-owned web
components to small imports/configuration reads. No Vex UI type enters provider drivers, trace capture,
provider runtime contracts or shared OTel mapping.

### Fixture and state-machine coverage

Required fixtures:

- Codex turn with exact turn/item times, reasoning and plan deltas/completed snapshots, command approval,
  stdout/stderr, tool failure, collaboration child, token updates and boundary-only compaction;
- Claude turn with stream block indices, thinking/text/tool-use/tool-result content, permission callback,
  task/subagent lineage, result usage/cost/timing, duration-derived compaction and a non-agent task;
- approval local decision plus provider acknowledgement deduplication;
- concurrent tools/tasks, orphan child relation and exact link behaviour;
- same-logical-call retry versus a new agent-issued tool call, expected cancellation, decline, terminal
  failure and forced incomplete-child closure;
- authoritative completed content differing from concatenated deltas, including explicit supersession
  chain and ambiguous-chain handling;
- unmapped native message retained as raw evidence;
- pre-turn baseline and post-turn workspace checkpoint events, including a post-closure technical
  carrier with real capture/diff timing;
- exact native span enrichment without duplicate operation counting;
- guarded `other` operation visibility and deduplicated taxonomy-gap diagnostics;
- exact versus estimated top-level usage/cost, including unsafe-estimate suppression and later exact
  supersession;
- completed/refused/blocked/partial response states independent of operation outcome;
- completed parent turn with an in-progress background child and active trace;
- replay, duplicate and late evidence under stable IDs/capture sequencing; and
- semantic-filtered, in-context technical expansion and all-spans projections over the same trace.

## Acceptance criteria

SHA-44 is implemented when tests demonstrate that:

1. one submitted turn yields one full-lifecycle `invoke_agent` root with the exact stable name, kind and
   required attributes above;
2. each role is created only from its stated evidence and uses the exact name/kind/parent/status rules;
3. Codex and Claude fixtures preserve asymmetric native IDs, timestamps, usage, cost, content and lineage
   with truthful fidelity/time markers;
4. no assistant/reasoning message fabricates a model call, no bare compaction/checkpoint fabricates a
   semantic span, and no delta/progress creates a span;
5. all prompts, responses, reasoning, tool inputs/results and command output reconstruct byte-for-byte
   from canonical trace records, including authoritative snapshot precedence and delta chronology;
6. every native provider observation is recoverable exactly once, including unsupported/unmapped event
   families;
7. approval decisions are deduplicated, denials are not errors, and tool/turn outcomes remain independent;
8. exact subagent parentage nests correctly while uncertain relations use links and never a guessed
   parent or invented Vex child turn;
9. OTel errors/status and Vex outcomes follow the lifecycle table, including handled child failure and
   recovered attempt cases;
10. the default query returns only the semantic tree plus visible hidden-span counts; in-context
    expansion and all-spans mode return technical/native spans with exact stored parentage and no
    duplication;
11. pre-turn baseline and post-turn workspace checkpoint events retain `CheckpointRef`, status and
    owning turn, including when a real technical capture span outlives the semantic root;
12. `in_progress` state/phase, terminal outcome, response disposition and trace activity behave
    independently, including completed parents with live background children;
13. logical-call retries, new tool calls and duplicate failure symptoms produce the correct semantic versus
    technical spans and logical error counts;
14. exact scoped totals win, estimates are visibly labelled/provenance-backed and unsafe estimates are
    absent;
15. guarded `other` operations remain visible with taxonomy-gap diagnostics until explicitly mapped;
16. exact native spans are enriched/reused without losing attributes, changing span ID or double-counting;
17. stable IDs/capture sequences make replay, late evidence and supersession deterministic;
18. all source records, canonical enums/mappings and projections carry their taxonomy/OTel/mapping
    versions and remain rebuildable without rewriting history; and
19. generic capture/contracts contain no Vex UI/product imports, while branded UI/configuration remains
    in the Vex-owned layer.

SHA-45 may choose the persistence/index implementation, SHA-46 the restart/late-event continuation
policy, and SHA-49 payload/backpressure limits. None may reopen this semantic hierarchy, fabricate
fidelity, or make projections/provider logs a hidden source of truth.

## Primary sources

- [OpenTelemetry GenAI semantic conventions, inspected revision](https://github.com/open-telemetry/semantic-conventions-genai/tree/150760c6252a4bb63c49c9915bad11997d316a15)
- [OpenTelemetry GenAI agent, workflow and planning spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-agent-spans.md)
- [OpenTelemetry GenAI inference, tool and content conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-spans.md)
- [OpenTelemetry GenAI attribute registry](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/registry/attributes/gen-ai.md)
- [OpenTelemetry core trace API 1.43](https://github.com/open-telemetry/opentelemetry-specification/blob/v1.43.0/specification/trace/api.md)
- [OpenTelemetry core error recording 1.43](https://github.com/open-telemetry/semantic-conventions/blob/v1.43.0/docs/general/recording-errors.md)
- [Codex app-server protocol sources at the pinned commit](https://github.com/openai/codex/tree/b39f943a634a6e7ba86c3d6e8cf6d5f35e612566/codex-rs/app-server-protocol/src/protocol)
- [Claude Agent SDK 0.3.170 published type surface](https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.170/sdk.d.ts)
- [Vex provider runtime event contract](../../packages/contracts/src/providerRuntime.ts)
- [Vex Codex session runtime](../../apps/server/src/provider/Layers/CodexSessionRuntime.ts)
- [Vex Codex adapter](../../apps/server/src/provider/Layers/CodexAdapter.ts)
- [Vex Claude adapter](../../apps/server/src/provider/Layers/ClaudeAdapter.ts)
- [Vex trace record implementation](../../packages/shared/src/observability.ts)
