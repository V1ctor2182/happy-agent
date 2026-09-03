# Native command workflows

Happy talks to the Claude SDK and Responses API directly; it does not embed either provider's
terminal UI. This module exposes the useful workflows from those UIs as ordinary Happy prompts,
so they keep the selected provider, model, effort, service tier, permission mode, queue behavior,
and mutation identity. Commands are available to every compatible provider because the behavior
comes from Happy's tools rather than a provider CLI.

Installed skills have precedence. If a `.agents/skills` entry has the same name as a built-in
workflow, the built-in is omitted and the skill owns that slash command. Skills also keep their
catalog slots before workflows when the protocol's 256-command bound is reached.

## Executable catalog

| Command                                     | Happy behavior                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/agents`, `/subagents`                     | Inspect or explicitly coordinate Happy coding subagents and bots.                               |
| `/code-review`, `/review`                   | Findings-first review of the current changes.                                                   |
| `/context`                                  | Inspect measured context-window and token usage.                                                |
| `/cost`, `/extra-usage`, `/stats`, `/usage` | Inspect Happy's recorded token and timing usage; monetary cost is reported only when available. |
| `/diff`                                     | Inspect staged, unstaged, and relevant untracked changes.                                       |
| `/doctor`                                   | Diagnose the Happy and project development environment.                                         |
| `/goal`                                     | Inspect or explicitly update the persistent conversation goal.                                  |
| `/help`                                     | Explain relevant Happy commands, skills, and tools.                                             |
| `/init`                                     | Inspect a repository and create or improve applicable `AGENTS.md` guidance.                     |
| `/mcp`                                      | Inspect or explicitly manage Happy's MCP servers and capabilities.                              |
| `/memories`, `/memory`                      | Inspect or explicitly update applicable durable instruction files.                              |
| `/pr-comments`                              | Inspect current pull-request review comments.                                                   |
| `/pwd`                                      | Report working directory, repository, workspace, and branch context.                            |
| `/recap`                                    | Summarize completed work, verification, decisions, and next steps.                              |
| `/security-review`                          | Perform a findings-first security review.                                                       |
| `/skills`                                   | List and explain Happy's current `.agents/skills` catalog.                                      |
| `/status`                                   | Summarize repository and active-work status.                                                    |
| `/tasks`                                    | Inspect or explicitly update persistent Happy tasks.                                            |

`/compact` is a direct lifecycle action owned by `CompactionsModule`. Every discovered skill is a
direct command owned by `SkillsModule`; names such as `/imagegen` or `/run` therefore appear when
the corresponding skill is installed instead of being copied into this module.

## Provider UI audit

The audit was performed against Claude Code 2.1.259 and Codex 0.149.1. A provider command is
published only when Happy can preserve its meaning. Terminal-host controls are filtered at this
boundary: advertising them as invokable would make the catalog lie, while launching or scraping
the provider CLIs would bypass Happy's shared history, tools, permissions, and queue.

### Claude Code

- Happy executable equivalents: `/compact`, `/context`, `/cost`, `/diff`, `/doctor`,
  `/extra-usage`, `/help`, `/init`, `/mcp`, `/memory`, `/pr-comments`, `/review`,
  `/security-review`, `/skills`, `/stats`, `/status`, `/tasks`, and `/usage`.
- Dynamic Happy skills: skill-backed entries such as `/code-review`, `/imagegen`, `/recap`, `/run`,
  `/simplify`, and `/spreadsheets` are discovered from `.agents/skills`; the built-in workflow
  aliases remain only when no same-named skill exists.
- Existing Happy composer controls, intentionally not duplicated as commands: `/effort`, `/fast`,
  `/model`, `/permissions`, and `/sandbox` select or describe invocation mode in the client. Happy
  does not let an inference mutate the mode carrying that same inference.
- Client/session navigation, requiring a future client-action contract rather than a prompt:
  `/btw`, `/clear`, `/copy`, `/export`, `/fork`, `/rename`, `/resume`, and `/rewind`.
- Claude terminal, account, IDE, and installation controls, unavailable because Happy does not
  host the Claude terminal UI: `/add-dir`, `/app`, `/chrome`, `/claude-api`, `/config`, `/debug`,
  `/desktop`, `/exit`, `/feedback`, `/ide`, `/install-github-app`, `/keybindings`, `/login`,
  `/logout`, `/mobile`, `/output-style`, `/privacy-settings`, `/release-notes`, `/remote-control`,
  `/remote-env`, `/statusline`, `/terminal-setup`, `/upgrade`, and `/vim`.
- Unsupported Claude-only extension/runtime controls: `/agents`, `/hooks`, `/passes`, `/plan`, and
  `/plugins`. Happy uses its own subagents, modules, workflows, and `.agents/skills`; Claude-native
  hooks, plugins, and Plan mode are not loaded. Happy's executable `/agents` workflow is the
  explicit replacement for inspecting or coordinating Happy subagents, not Claude's agent editor.

### Codex

- Happy executable equivalents: `/agents`, `/compact`, `/diff`, `/goal`, `/init`, `/mcp`,
  `/memories`, `/pwd`, `/review`, `/skills`, `/status`, `/subagents`, and `/usage`.
- Existing Happy composer controls, intentionally not duplicated as commands: `/fast`, `/model`,
  and `/permissions`.
- Client/session navigation or presentation, requiring a future client-action contract:
  `/archive`, `/clear`, `/copy`, `/delete`, `/export`, `/fork`, `/mention`, `/new`, `/raw`,
  `/rename`, `/resume`, `/side`, and `/title`.
- Codex terminal/account/process controls, unavailable because Happy does not host the Codex TUI:
  `/app`, `/cd`, `/exit`, `/feedback`, `/ide`, `/keymap`, `/logout`, `/pets`, `/personality`,
  `/ps`, `/statusline`, `/stop`, `/theme`, and `/vim`.
- Unsupported Codex-only runtime controls: `/approve`, `/experimental`, `/hooks`, `/import`,
  `/plan`, and `/plugins`. Happy owns permissions, lifecycle hooks, history, and extensions, and
  intentionally has no Codex Plan-mode or plugin runtime.

When either provider adds a command, classify it here before publishing it. Implement a direct
Happy lifecycle action or a truthful workflow when possible; keep host-only controls filtered
until the slash-command protocol can represent the required client action.
