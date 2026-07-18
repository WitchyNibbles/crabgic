/**
 * `FakeToolCall` — the minimal shape every fake-engine layer evaluator
 * (permission/sandbox/adjudication, roadmap/03-envelope-compiler-engine-
 * adapter.md §In scope "Fake engine" bullet) reads a scripted tool call
 * through. Deliberately narrower than `@eo/engine-core`'s `EngineToolUseEvent`
 * (no `toolUseId`/`toolResult`) — those fields are replay-stream concerns,
 * not evaluation inputs.
 */
export interface FakeToolCall {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}
