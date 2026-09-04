# Model discovery internals

- `discoveryOutcome.ts` — the three answers a vendor listing can produce: discovered routes, no
  credential to ask with, or a failed request with its reason.
- `codexDiscoveredModels.ts` — reads a Codex `/models` response (the same shape as the Codex
  CLI's `models_cache.json`) into `openai/<slug>` routes, keeping only visible models and the
  efforts Happy offers, ordered by the vendor's priority.
- `fetchCodexModels.ts` — chooses the account's credential exactly as its provider does, asks the
  ChatGPT backend with a ChatGPT sign-in, and otherwise falls back to the CLI cache beside the
  account's auth file, then the machine's Codex home when the account is not isolated.
- `claudeDiscoveredModels.ts` — reads an Anthropic `/v1/models` listing into `claude-…` routes,
  skipping the vendor IDs the curated `anthropic/…` routes already resolve to and collapsing a
  model listed under several IDs onto its newest one.
- `fetchClaudeModels.ts` — chooses the account's credential in the provider's order and pages
  through the listing.
- `readClaudeCodeOAuthToken.ts` — the Claude Code sign-in token from the macOS keychain or
  `.credentials.json`, mirroring the provider package's own reader, which it does not export.
