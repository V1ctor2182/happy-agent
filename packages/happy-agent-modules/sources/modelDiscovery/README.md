# Model discovery module

`ModelDiscoveryModule` keeps each signed-in Codex and Claude account's model list current, so a
model the vendor ships after this build appears in the picker without a source edit. It takes
`ConfigModule`, which owns the curated catalog, the accounts, and the durable discovered list, and
`DurableFunctionsModule`, which carries a requested refresh across a restart.

```
                 curated catalog (source)            discovered-models.json (durable)
                          │                                     ▲
                          ▼                                     │ updateDiscoveredModels
   ConfigModule.catalog = curated + discovered  ◄────── ModelDiscoveryModule.refresh
                          │                                     ▲
        GET /v0/config, models, modelContext                    │
                          │                     ┌───────────────┼──────────────────┐
                          ▼                     │ startup + 5s  │ hourly           │ API: scan /
                 ApiModule ──config.updated──►   │ (beforeStart) │ (forever loop)   │ verify / enable
                                                └───────────────┴──────────────────┘
```

## When it asks

Nothing runs on the startup path or while a session is created. `beforeStart` starts one loop per
eligible account: it waits five seconds, refreshes, then refreshes every hour. The API module asks
for a refresh after a provider scan finds credentials, after a verification passes, and after a
person enables a provider; those requests go through Durable Functions with one operation ID per
account, so a pending request survives a restart and a second request joins the first.

## What it asks

- **Codex.** A ChatGPT sign-in is asked `GET {backend}/codex/models?client_version=…` with the
  session token and account ID, the request the Codex CLI makes for its own picker. The version
  is the installed CLI's, else the one recorded in the CLI's cache, else a baked-in recent one.
  An API-key account has no catalog endpoint, and a failed request must not empty the picker, so
  both read the CLI's own `models_cache.json`: the one beside the account's `auth_file` first,
  then the machine's Codex home unless the account is credential-isolated. Only models the
  vendor marks visible are offered; efforts outside Happy's vocabulary, such as `ultra`, are
  dropped.
- **Claude.** The account is asked `GET https://api.anthropic.com/v1/models`, paginated, with the
  credential the provider itself would use: a configured OAuth token, an API key, an auth token,
  or the Claude Code sign-in on this machine. Discovered Claude routes keep the vendor's ID
  (`claude-…`) because the published provider package maps only the curated `anthropic/…` aliases
  and passes every other ID to Claude Code unchanged. The listing carries no context size, so a
  discovered Claude route is offered at 200k with every effort and a medium default.

## What configuration does with it

Configuration appends discovered routes behind the account's curated routes, keeps a curated entry
whenever both name the same ID, and applies `include_models` / `exclude_models` to both. The
answer is written atomically to `~/.happy/agent/discovered-models.json`, so the next start offers
the same routes before any account is asked again. `discover_models = false` on a provider keeps
its catalog curated only, and a scripted test catalog is never extended.

`refresh(ctx, providerId)` returns the account's status; `onEvent` reports a changed list with the
IDs added and removed, which the API module turns into `config.updated`. A refresh that cannot ask
or fails records why in `list()` and leaves the last durable answer in place.
