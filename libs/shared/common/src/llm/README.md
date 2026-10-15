# The `llm` SDK: SDK for LLM integration and prompt management

## Two-model minimum

`completion()` / `completionWithMeta()` require `models` to resolve to at least two
entries (a `ModelChain`) or a `ModelTier` string -- this is enforced by
`CompletionOptions` at compile time, mirroring the SDK's own runtime check.
A single-model `models` array only compiles alongside one of the SDK's own
skip conditions: `ignoreFallbackModel: true`, `enableSearch`, `enableResponseChain: true`,
or `previousResponseId`.
