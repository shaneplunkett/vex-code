# Turn-observability capture seam

**Decision date:** 22 July 2026  
**Issue:** SHA-43

## Decision

Put the provider-neutral capture seam in one server-owned **Turn Trace Capture** module. `ProviderCommandReactor` starts a capture when it begins handling the persisted `thread.turn-start-requested` intent; the module then consumes the one instance-correlated canonical stream already exposed by `ProviderService.streamEvents`. It owns the long-lived `invoke_agent` CLIENT span, provider-turn alias binding, child-span state, terminal closure, and live updates.

The invocation span starts after the orchestration command has been accepted and dequeued, immediately before session ensure/recovery and provider send. It ends only on accepted canonical terminal evidence or an invocation failure. `sendTurn` returning is an acknowledgement and ID-binding point, not completion. Browser closure, WebSocket acknowledgement/disconnect, subscription replay, projection completion, and runtime-session replacement never own its lifetime.

This is the narrowest seam with all required facts: the reactor has stable `commandId`, thread, message, requested model and invocation failures; `ProviderService` has the single provider-neutral event stream after driver-instance correlation. Starting in the browser/RPC ends too early, starting in ingestion is too late, and starting in each adapter duplicates lifecycle normalisation.

## Trace shape and ownership

```text
browser turn.submit                         INTERNAL, short; root when present
  Effect RPC client/server + ws.rpc         CLIENT/SERVER, dispatch attempt only
    orchestration command persist/ack       INTERNAL, runtime context propagated
      invoke_agent <agent>                  CLIENT, lifecycle anchor (long-lived)
        provider session ensure/recover     INTERNAL
        provider adapter turn/start         CLIENT/INTERNAL, request acknowledgement
        provider-process spans              native children where propagation exists
        execute_tool ...                    INTERNAL, canonical lifecycle-derived
        approval/task/content events        span/events per SHA-44 taxonomy
        provider event ingestion/storage    INTERNAL, re-entered under turn context
```

The browser submit span is the actual trace root for an ordinary user-originated turn when its context reaches the first accepted dispatch. It ends at dispatch acknowledgement; OTel permits descendants to outlive a parent, and the server-owned invocation span keeps the trace live. If there is no valid client context (recovery, provider-originated or synthetic work), the invocation span becomes the trace root and records that provenance.

The `invoke_agent` span is the **lifecycle anchor** and semantic root shown by the default explorer even when browser/RPC ancestors exist in the all-spans view. This preserves the SHA-41 decision: one full-lifecycle `invoke_agent` CLIENT span, with queued orchestration wait outside it. The standard says an agent client span covers the logical invocation through the final response, not only request acknowledgement ([OTel GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/150760c6252a4bb63c49c9915bad11997d316a15/docs/gen-ai/gen-ai-agent-spans.md)).

## Propagation rules

1. **Browser to WebSocket RPC:** use Effect RPC's existing per-request propagation. Its request envelope carries `traceId`, `spanId`, and sampling state and the server creates a span with that external parent ([client](../../.repos/effect-smol/packages/effect/src/unstable/rpc/RpcClient.ts), [server](../../.repos/effect-smol/packages/effect/src/unstable/rpc/RpcServer.ts), [wire message](../../.repos/effect-smol/packages/effect/src/unstable/rpc/RpcMessage.ts)). Do not invent a second `traceparent` field in orchestration commands.
2. **RPC to orchestration queue:** capture the current parent in the runtime-only `CommandEnvelope` and re-enter it in the queue worker. Do not persist tracer objects or add telemetry fields to `OrchestrationCommand`/`OrchestrationEvent` schemas. The current queue envelope carries only command/result/timing and therefore loses ambient fibre context ([engine](../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts)).
3. **Persisted intent to invocation:** associate serialisable trace context with the stable command ID in the observability state/journal. `begin(commandId)` is idempotent. The reactor retrieves it when processing `thread.turn-start-requested` and creates the lifecycle span before provider work ([reactor](../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts)).
4. **Across PubSub/workers:** never assume ambient Effect context survives. Look up the active turn by command ID, then thread/provider-instance/provider-turn aliases, and run ingestion/capture work with the invocation span as parent. Current orchestration PubSub, provider PubSub and drainable workers are explicit async seams.
5. **Into provider adapters:** run `ProviderService.sendTurn` and adapter calls under the invocation context, producing short child spans. Register the pending invocation before calling the provider because `turn.started` may race the `sendTurn` response.
6. **Into provider processes:** inject W3C Trace Context only on a protocol that supports it. Codex JSON-RPC defines optional `trace.traceparent`/`tracestate`, but Vex's patched transport currently omits it ([generated schema](../../packages/effect-codex-app-server/src/_generated/schema.gen.ts), [transport](../../packages/effect-codex-app-server/src/protocol.ts)). Populate it from the current outbound request span. Claude Agent SDK does not expose an equivalent per-turn carrier in the pinned integration; do not fabricate one. Ingest its native telemetry as linked evidence correlated by provider/session/turn IDs.
7. **Back to the browser:** multiplexed subscriptions and reconnects are delivery traces, not turn parents. Link delivery/render spans to the active turn when useful; never hold the turn open for a subscriber.

Use W3C Trace Context semantics at real process boundaries; `traceparent` identifies the incoming parent and `tracestate` is forwarded without using it as application state ([W3C Trace Context](https://www.w3.org/TR/trace-context/)). Use span links when one attempt relates to an already-existing turn or when native provider telemetry cannot join the trace directly; links represent causal relationships without pretending single-parent nesting ([OTel trace data model](https://opentelemetry.io/docs/specs/otel/overview/#links-between-spans)).

## Canonical and raw capture

Semantic child spans are derived **once** from `ProviderService.streamEvents`, after `correlateRuntimeEventWithInstance` and before projection-specific ingestion. This stream already contains provider-neutral event type, thread/turn/item/request IDs, provider instance, payload and optional raw evidence ([contract](../../packages/contracts/src/providerRuntime.ts), [publication](../../apps/server/src/provider/Layers/ProviderService.ts)).

Provider adapters retain one separate, interpretation-free raw evidence tap for native messages that have no canonical event. That tap records payload, provider/instance/version, receive time and native IDs; it does not open or close semantic spans. The Turn Trace Capture module joins raw evidence to canonical spans and applies the SHA-41 semantic-convention mapping. `ProviderRuntimeIngestion` remains a read-model projector and must not become a second trace normaliser.

Do not create a span per streamed text/output delta. Record or chunk deltas as events/content evidence and update the bounded semantic span. Tool, approval, task and subagent child boundaries are decided by SHA-44, but their state machines live behind this same capture interface.

## Lifecycle table

| Observation                                     | Capture action                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Reactor accepts a new turn-start intent         | Start `invoke_agent`; register command/thread/provider-instance aliases before provider call |
| Duplicate command/replayed dispatch             | Return existing capture; link the new transport attempt; never start a second invocation     |
| Provider session start/recovery                 | Child operation; runtime-session replacement does not replace the turn trace                 |
| `sendTurn` response                             | Bind provider-native turn ID/resume cursor; keep invocation open                             |
| `turn.started` before response                  | Bind the oldest compatible pending invocation, then reconcile the later response             |
| Item/request/task start/update/end              | Open/update/end child according to stable native/canonical identity                          |
| Interrupt/approval/user-input command           | Record linked intent/response work; do not end invocation                                    |
| Accepted `turn.completed` or `turn.aborted`     | Close remaining children explicitly, annotate outcome/fidelity, end invocation               |
| Pre-start provider failure                      | End invocation as error with low-cardinality `error.type`                                    |
| Session/process terminal event with active turn | Close or continue according to SHA-46 recovery policy; never silently succeed                |
| WS/browser disconnect or subscription replay    | No lifecycle change                                                                          |

Provider-originated or synthetic turns with no compatible pending command start their own provider-originated capture with explicit provenance; they must not hijack the latest user turn merely because the thread IDs match.

## Reconnect and restart behaviour

- `commandId` is the stable pre-provider key and existing command receipts make dispatch idempotent. A lost acknowledgement may create another RPC attempt but not another turn trace.
- Client/WebSocket reconnect does not affect a server-owned span. New attempts link to the capture already keyed by command ID.
- Persist only serialisable trace/span context plus capture state, never a live Effect span object. A process restart cannot reopen the same OTel span ID. SHA-45/SHA-46 must choose the exact recovery journal and terminal policy; recovery creates a linked continuation span in the same logical turn rather than forging one uninterrupted span.
- The current local tracer writes only ended spans, so it cannot by itself power live active traces ([shared tracer](../../packages/shared/src/observability.ts)). Turn Trace Capture must publish start/update/end mutations to the active-trace journal/stream while also producing the eventual OTel record. This is one state machine with two sinks, not a second observability model.

## Rejected seams

| Candidate                               | Why rejected                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Browser-owned long-lived span           | Reload/disconnect can orphan it; provider terminal facts are server-side                  |
| WebSocket handler                       | Ends at dispatch acknowledgement; retries/reconnects duplicate ownership                  |
| Orchestration command worker            | Owns persistence acknowledgement, not provider lifecycle                                  |
| `ProviderRuntimeIngestion`              | Sees the start only after provider evidence and mixes projection semantics into capture   |
| Each provider adapter                   | Duplicates lifecycle and OTel mapping and makes provider asymmetry the shared contract    |
| Provider-native OTel as source of truth | Codex/Claude propagation and fidelity differ; cannot cover browser/orchestration reliably |

## Module seam

The external interface should stay small and lifecycle-shaped:

- begin/idempotently recover a capture from turn intent and optional upstream context;
- run work under / link work to an active capture;
- bind provider aliases;
- accept canonical provider events and raw evidence;
- fail a start; and
- expose live capture mutations.

Keep OTel mapping, active-span registry, alias resolution, races, forced child closure, raw-evidence joining and tracer/storage adapters inside the module. Test through this interface with an in-memory tracer/journal. This is a deep module: callers report facts they uniquely own; they do not learn provider-specific span rules.

## Placement and thin-fork impact

Place the generic capture module under server observability and keep it provider-neutral. The required upstream-owned edits are narrow hooks: runtime context capture in orchestration dispatch, one begin/fail wrapper in `ProviderCommandReactor`, one canonical-event tap in `ProviderService`, and protocol-context injection inside provider transports that support it. Vex-only persistence/query/UI policy remains in the Vex layer selected through adapters. No provider adapter should import Vex UI/product modules, and no trace fields enter persistent chat contracts.

## Decisions deferred, not reopened

SHA-44 chooses the exact child-span taxonomy. SHA-45 validates the active/completed trace journal and retention. SHA-46 fixes recovery timeouts and terminal semantics. SHA-49 sets payload/backpressure limits. Those tickets may refine implementation, but they must preserve this ownership seam and the rule that semantic normalisation happens once.
