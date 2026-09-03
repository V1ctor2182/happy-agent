import type {
    AgentBaseMessageOptions,
    AgentQueuedMessage,
    AgentSystemRef,
} from "@slopus/happy-agent-base";
import { createRootContext } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import { NativeCommandsModule } from "../../sources/nativeCommands/index.js";
import { resolveModuleHooks } from "../support/moduleHooks.js";

const ctx = createRootContext().named("native-commands-module-test");
const agentId = "agent-a";

describe("NativeCommandsModule", () => {
    it("publishes the executable workflow catalog", async () => {
        const module = new NativeCommandsModule();
        const commands = await module.slashCommands(ctx, agentId);

        expect(module.name).toBe("native-commands");
        expect(commands.map((command) => command.name)).toEqual([
            "agents",
            "code-review",
            "context",
            "cost",
            "diff",
            "doctor",
            "extra-usage",
            "goal",
            "help",
            "init",
            "mcp",
            "memories",
            "memory",
            "pr-comments",
            "pwd",
            "recap",
            "review",
            "security-review",
            "skills",
            "stats",
            "status",
            "subagents",
            "tasks",
            "usage",
        ]);
        expect(commands).toContainEqual({
            description: "Report the current working directory and repository context.",
            hasArguments: false,
            kind: "workflow",
            name: "pwd",
        });
    });

    it("turns an invocation into an ordinary queued prompt with the selected mode", async () => {
        const module = new NativeCommandsModule();
        let sent:
            | {
                  readonly message: AgentQueuedMessage;
                  readonly options: AgentBaseMessageOptions | undefined;
              }
            | undefined;
        let metadataUpdate: unknown;
        const agents = {
            send: async (
                _ctx: unknown,
                _agentId: string,
                message: AgentQueuedMessage,
                options?: AgentBaseMessageOptions,
            ) => {
                sent = { message, options };
                return {} as never;
            },
            updateMetadata: async (_ctx: unknown, _agentId: string, update: unknown) => {
                metadataUpdate = update;
                return {} as never;
            },
        } as unknown as AgentSystemRef;
        await resolveModuleHooks(ctx, module, agents);

        await module.invokeSlashCommand(ctx, agentId, "review", {
            arguments: "Focus on authentication.",
            mode: {
                effort: "high",
                modelId: "anthropic/sonnet-5",
                permissionMode: "auto",
                providerId: "claude",
                serviceTier: "priority",
            },
            mutationId: "command-1",
        });

        expect(sent?.message).toEqual({
            role: "user",
            content: [
                {
                    type: "text",
                    text: expect.stringMatching(
                        /Review the current changes[\s\S]+Additional instructions:\nFocus on authentication\./u,
                    ),
                },
            ],
        });
        expect(sent?.options).toMatchObject({
            effort: "high",
            metadata: {
                mutationId: "command-1",
                mode: { modelId: "anthropic/sonnet-5" },
            },
            model: "anthropic/sonnet-5",
            permissionMode: "auto",
            provider: "claude",
            serviceTier: "priority",
        });
        expect(metadataUpdate).toEqual({
            lastMode: expect.objectContaining({ modelId: "anthropic/sonnet-5" }),
        });
    });

    it("rejects commands it does not own and invocation before startup", async () => {
        const module = new NativeCommandsModule();
        const input = {
            mode: {
                effort: "medium" as const,
                modelId: "openai/gpt-5.6-sol",
                permissionMode: "auto" as const,
                providerId: "codex",
                serviceTier: null,
            },
        };

        await expect(module.invokeSlashCommand(ctx, agentId, "missing", input)).rejects.toThrow(
            "does not own /missing",
        );
        await expect(module.invokeSlashCommand(ctx, agentId, "status", input)).rejects.toThrow(
            "has not started",
        );
    });
});
