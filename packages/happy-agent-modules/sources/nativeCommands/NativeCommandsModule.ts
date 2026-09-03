import { createId } from "@paralleldrive/cuid2";
import type { AgentModule, AgentModuleHooks, AgentSystemRef } from "@slopus/happy-agent-base";
import type { InvokeSlashCommandRequest } from "@slopus/happy-agent-client";
import type { Context } from "@steve.kite/stdlib";

import { USER_MESSAGE_ORIGIN_METADATA } from "../impl/messageOrigin.js";
import type { SlashCommandDefinition } from "../slashCommands/index.js";

interface NativeWorkflowCommand extends SlashCommandDefinition {
    readonly prompt: string;
}

const NATIVE_WORKFLOW_COMMANDS = [
    {
        description: "Inspect or coordinate Happy coding subagents and bots.",
        hasArguments: true,
        kind: "workflow",
        name: "agents",
        prompt: "Inspect the coding subagents, persistent bots, and delegated work visible to this conversation. Summarize their current state. Do not create, message, or interrupt one unless the additional instructions explicitly request it.",
    },
    {
        description: "Review the current changes for correctness and regressions.",
        hasArguments: true,
        kind: "workflow",
        name: "code-review",
        prompt: "Review the current changes. Lead with concrete findings ordered by severity and include file and line references. Check correctness, regressions, security, and missing verification. Do not edit files unless the additional instructions explicitly request fixes.",
    },
    {
        description: "Report current context-window and token usage.",
        hasArguments: true,
        kind: "workflow",
        name: "context",
        prompt: "Inspect this agent's current context-window and token usage with the available usage tools. Report the important totals and whether compaction is worth considering. Do not change anything.",
    },
    {
        description: "Report token and timing usage for this conversation.",
        hasArguments: true,
        kind: "workflow",
        name: "cost",
        prompt: "Inspect this conversation's available token and timing usage. Report exact recorded values and clearly say when monetary cost is not available. Do not change anything.",
    },
    {
        description: "Inspect and explain the current Git diff.",
        hasArguments: true,
        kind: "workflow",
        name: "diff",
        prompt: "Inspect the current Git diff, including staged, unstaged, and relevant untracked changes. Summarize what changed and flag likely risks. Do not edit files.",
    },
    {
        description: "Diagnose the Happy and project development environment.",
        hasArguments: true,
        kind: "workflow",
        name: "doctor",
        prompt: "Diagnose this Happy Agent and project development environment. Inspect relevant configuration, tool availability, repository state, and recent evidence, then report concrete problems and remedies. Do not apply fixes unless the additional instructions explicitly request them.",
    },
    {
        description: "Report detailed token and timing usage.",
        hasArguments: true,
        kind: "workflow",
        name: "extra-usage",
        prompt: "Inspect detailed token and timing usage for this conversation and its agent tree. Report the useful breakdowns and call out unavailable measurements. Do not change anything.",
    },
    {
        description: "Inspect or update this conversation's persistent goal.",
        hasArguments: true,
        kind: "workflow",
        name: "goal",
        prompt: "Inspect this conversation's persistent goal. Without additional instructions, report its objective, status, and next action. With additional instructions, update or create the goal only as requested.",
    },
    {
        description: "Explain the Happy commands and capabilities relevant here.",
        hasArguments: true,
        kind: "workflow",
        name: "help",
        prompt: "Explain the Happy Agent commands, installed skills, and tools relevant to this conversation. Be concise, distinguish workflow commands from client controls, and answer any additional question supplied.",
    },
    {
        description: "Initialize repository guidance for future agent work.",
        hasArguments: true,
        kind: "workflow",
        name: "init",
        prompt: "Initialize this repository for future agent work. Inspect its structure, commands, conventions, and existing instruction files. Create or improve the applicable AGENTS.md only when useful, preserve existing project guidance, and summarize any changes.",
    },
    {
        description: "Inspect or manage configured MCP servers and capabilities.",
        hasArguments: true,
        kind: "workflow",
        name: "mcp",
        prompt: "Inspect the MCP servers configured for this agent and summarize their status, tools, resources, and prompts. Do not alter configuration unless the additional instructions explicitly request a change.",
    },
    {
        description: "Inspect or update the instructions remembered for this project.",
        hasArguments: true,
        kind: "workflow",
        name: "memories",
        prompt: "Inspect the durable instructions and memory applicable to this project and conversation, including relevant AGENTS.md files. Without additional instructions, summarize them. With additional instructions, update only the appropriate durable instruction file and explain the change.",
    },
    {
        description: "Inspect or update the instructions remembered for this project.",
        hasArguments: true,
        kind: "workflow",
        name: "memory",
        prompt: "Inspect the durable instructions and memory applicable to this project and conversation, including relevant AGENTS.md files. Without additional instructions, summarize them. With additional instructions, update only the appropriate durable instruction file and explain the change.",
    },
    {
        description: "Inspect and address review comments on the current pull request.",
        hasArguments: true,
        kind: "workflow",
        name: "pr-comments",
        prompt: "Inspect review comments on the pull request associated with the current branch. Summarize unresolved requests and assess each one. Do not edit, reply, resolve, push, or merge unless the additional instructions explicitly request it.",
    },
    {
        description: "Report the current working directory and repository context.",
        hasArguments: false,
        kind: "workflow",
        name: "pwd",
        prompt: "Report the current working directory, repository root, active workspace or branch, and the path context relevant to this agent. Do not change anything.",
    },
    {
        description: "Recap the conversation, completed work, and next steps.",
        hasArguments: true,
        kind: "workflow",
        name: "recap",
        prompt: "Recap this conversation and the work performed so far. Separate completed work, verification, unresolved decisions, and concrete next steps. Use durable history when needed and do not change anything.",
    },
    {
        description: "Review the current changes for correctness and regressions.",
        hasArguments: true,
        kind: "workflow",
        name: "review",
        prompt: "Review the current changes. Lead with concrete findings ordered by severity and include file and line references. Check correctness, regressions, security, and missing verification. Do not edit files unless the additional instructions explicitly request fixes.",
    },
    {
        description: "Perform a focused security review of the current changes.",
        hasArguments: true,
        kind: "workflow",
        name: "security-review",
        prompt: "Perform a security review of the current changes and relevant surrounding code. Lead with exploitable findings ordered by severity, include file and line references, and explain impact and remediation. Do not edit files unless the additional instructions explicitly request fixes.",
    },
    {
        description: "List and explain the skills available to this agent.",
        hasArguments: true,
        kind: "workflow",
        name: "skills",
        prompt: "List the skills available to this agent. Summarize what each relevant skill is for and recommend the smallest useful set for any additional task. Do not modify skill files.",
    },
    {
        description: "Report token and timing statistics for this conversation.",
        hasArguments: true,
        kind: "workflow",
        name: "stats",
        prompt: "Inspect token and timing statistics for this conversation and its agent tree. Report exact recorded values, useful breakdowns, and unavailable measurements. Do not change anything.",
    },
    {
        description: "Summarize repository and current-work status.",
        hasArguments: true,
        kind: "workflow",
        name: "status",
        prompt: "Inspect and summarize the current project status: repository and branch, staged, unstaged, and untracked changes, active work, and relevant verification results. Do not edit files.",
    },
    {
        description: "Inspect or coordinate Happy coding subagents.",
        hasArguments: true,
        kind: "workflow",
        name: "subagents",
        prompt: "Inspect the coding subagents and delegated work visible to this conversation. Summarize their current state. Do not create, message, or interrupt one unless the additional instructions explicitly request it.",
    },
    {
        description: "List or manage this conversation's persistent tasks.",
        hasArguments: true,
        kind: "workflow",
        name: "tasks",
        prompt: "Inspect this conversation's persistent tasks. Without additional instructions, summarize pending, blocked, and completed work. With additional instructions, make only the requested task changes.",
    },
    {
        description: "Report token and timing usage for this conversation.",
        hasArguments: true,
        kind: "workflow",
        name: "usage",
        prompt: "Inspect this conversation's token and timing usage with the available usage tools. Report exact recorded values and useful breakdowns. Do not change anything.",
    },
] as const satisfies readonly NativeWorkflowCommand[];

/** Happy-native, provider-independent equivalents for useful Claude Code and Codex workflows. */
export class NativeCommandsModule implements AgentModule {
    readonly name = "native-commands";
    #agents: AgentSystemRef | undefined;

    async slashCommands(
        _ctx: Context,
        _agentId: string,
    ): Promise<readonly SlashCommandDefinition[]> {
        return NATIVE_WORKFLOW_COMMANDS.map(({ prompt: _prompt, ...command }) => command);
    }

    async invokeSlashCommand(
        ctx: Context,
        agentId: string,
        name: string,
        input: InvokeSlashCommandRequest,
    ): Promise<void> {
        const command = NATIVE_WORKFLOW_COMMANDS.find((candidate) => candidate.name === name);
        if (command === undefined)
            throw new Error(`The native commands module does not own /${name}.`);
        const agents = this.#agents;
        if (agents === undefined) throw new Error("The native commands module has not started.");
        const id = createId();
        const text =
            input.arguments === undefined
                ? command.prompt
                : `${command.prompt}\n\nAdditional instructions:\n${input.arguments}`;
        await agents.send(
            ctx,
            agentId,
            { role: "user", content: [{ type: "text", text }] },
            {
                effort: input.mode.effort as never,
                id,
                metadata: {
                    ...USER_MESSAGE_ORIGIN_METADATA,
                    ...(input.mutationId === undefined ? {} : { mutationId: input.mutationId }),
                    mode: input.mode,
                },
                model: input.mode.modelId,
                permissionMode: input.mode.permissionMode,
                provider: input.mode.providerId,
                ...(input.mode.serviceTier === null
                    ? {}
                    : { serviceTier: input.mode.serviceTier as never }),
            },
        );
        await agents.updateMetadata(ctx, agentId, { lastMode: input.mode });
    }

    readonly beforeStart = (_ctx: Context, agents: AgentSystemRef): AgentModuleHooks => {
        this.#agents = agents;
        return {};
    };
}
