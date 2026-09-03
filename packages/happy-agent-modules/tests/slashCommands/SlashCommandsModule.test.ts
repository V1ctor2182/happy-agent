import type { Context } from "@steve.kite/stdlib";
import { MAX_SLASH_COMMANDS } from "@slopus/happy-agent-client";
import { describe, expect, it } from "vitest";

import {
    EventsModule,
    SlashCommandInputError,
    SlashCommandNotFoundError,
    SlashCommandsModule,
    type SlashCommandContributor,
    type SlashCommandDefinition,
    type SlashCommandInvocation,
} from "../../sources/index.js";
import { moduleDatabase } from "../support/moduleDatabase.js";

const invocation: SlashCommandInvocation = {
    mode: {
        effort: "medium",
        modelId: "openai/gpt-5.6-sol",
        permissionMode: "auto",
        providerId: "codex",
        serviceTier: null,
    },
};

const agents = {
    config: () => Promise.resolve({}),
} as never;

class Contributor implements SlashCommandContributor {
    readonly name: string;
    definitions: SlashCommandDefinition[];
    invocations: {
        readonly agentId: string;
        readonly input: SlashCommandInvocation;
        readonly name: string;
    }[] = [];

    constructor(name: string, definitions: SlashCommandDefinition[]) {
        this.name = name;
        this.definitions = definitions;
    }

    async slashCommands(
        _ctx: Context,
        _agentId: string,
    ): Promise<readonly SlashCommandDefinition[]> {
        return structuredClone(this.definitions);
    }

    async invokeSlashCommand(
        _ctx: Context,
        agentId: string,
        name: string,
        input: SlashCommandInvocation,
    ): Promise<void> {
        this.invocations.push({ agentId, input: structuredClone(input), name });
    }
}

describe("SlashCommandsModule", () => {
    it("keeps image bytes private, dispatches to the owner, and emits only real changes", async () => {
        const events = new EventsModule();
        const database = moduleDatabase(events.migrations ?? [], "slash-command-catalog-test");
        await database.ready;
        try {
            await events.beforeStart?.(database.context);
            const origin = events.originCursor();
            const owner = new Contributor("feature", [
                {
                    description: "Review the current changes.",
                    hasArguments: true,
                    image: {
                        blob: new Uint8Array([1, 2, 3]),
                        mediaType: "image/png",
                        thumbhash: "thumbhash",
                    },
                    kind: "skill",
                    name: "review",
                },
            ]);
            const commands = new SlashCommandsModule(events, owner);
            await commands.beforeStart?.(database.context, agents);

            await expect(commands.catalog(database.context, "agent-1")).resolves.toEqual([
                {
                    description: "Review the current changes.",
                    hasArguments: true,
                    image: { thumbhash: "thumbhash" },
                    kind: "skill",
                    name: "review",
                },
            ]);
            const image = await commands.image(database.context, "agent-1", "review");
            expect(image?.mediaType).toBe("image/png");
            expect([...((image?.blob ?? new Uint8Array()) as Uint8Array)]).toEqual([1, 2, 3]);
            expect(image?.etag).toMatch(/^"[a-f0-9]{64}"$/u);
            expect(events.replay(origin)?.events.map((event) => event.type)).toEqual([
                "slash_commands.updated",
            ]);

            await commands.refresh(database.context, "agent-1");
            expect(events.replay(origin)?.events).toHaveLength(1);

            await commands.invoke(database.context, "agent-1", "review", {
                ...invocation,
                arguments: "focus on authentication",
            });
            expect(owner.invocations).toEqual([
                {
                    agentId: "agent-1",
                    input: { ...invocation, arguments: "focus on authentication" },
                    name: "review",
                },
            ]);

            owner.definitions[0] = {
                ...owner.definitions[0]!,
                image: {
                    ...owner.definitions[0]!.image!,
                    blob: new Uint8Array([4, 5, 6]),
                },
            };
            await commands.refresh(database.context, "agent-1");
            expect(events.replay(origin)?.events).toHaveLength(2);

            owner.definitions[0] = {
                ...owner.definitions[0]!,
                image: {
                    ...owner.definitions[0]!.image!,
                    mediaType: "image/webp",
                },
            };
            await commands.refresh(database.context, "agent-1");
            expect(events.replay(origin)?.events).toHaveLength(3);
        } finally {
            database.close();
        }
    });

    it("rejects duplicate names, unknown commands, and arguments on argument-free commands", async () => {
        const events = new EventsModule();
        const database = moduleDatabase(events.migrations ?? [], "slash-command-errors-test");
        await database.ready;
        try {
            await events.beforeStart?.(database.context);
            const compact = {
                description: "Compact context.",
                hasArguments: false,
                name: "compact",
            } satisfies SlashCommandDefinition;
            const commands = new SlashCommandsModule(
                events,
                new Contributor("one", [compact]),
                new Contributor("two", [compact]),
            );
            await commands.beforeStart?.(database.context, agents);
            await expect(commands.refresh(database.context, "agent-1")).rejects.toThrow(
                "More than one module returned the /compact command",
            );

            const valid = new SlashCommandsModule(events, new Contributor("one", [compact]));
            await valid.beforeStart?.(database.context, agents);
            await expect(
                valid.invoke(database.context, "agent-1", "missing", invocation),
            ).rejects.toBeInstanceOf(SlashCommandNotFoundError);
            await expect(
                valid.invoke(database.context, "agent-1", "compact", {
                    ...invocation,
                    arguments: "now",
                }),
            ).rejects.toBeInstanceOf(SlashCommandInputError);
        } finally {
            database.close();
        }
    });

    it("gives skills precedence over workflow aliases and catalog capacity", async () => {
        const events = new EventsModule();
        const database = moduleDatabase(events.migrations ?? [], "slash-command-priority-test");
        await database.ready;
        try {
            await events.beforeStart?.(database.context);
            const workflows = new Contributor(
                "workflows",
                Array.from({ length: MAX_SLASH_COMMANDS }, (_, index) => ({
                    description: `Workflow ${String(index)}.`,
                    hasArguments: true,
                    kind: "workflow",
                    name: index === 0 ? "review" : `workflow-${String(index)}`,
                })),
            );
            const skills = new Contributor("skills", [
                {
                    description: "Project review skill.",
                    hasArguments: true,
                    kind: "skill",
                    name: "review",
                },
                {
                    description: "Project build skill.",
                    hasArguments: true,
                    kind: "skill",
                    name: "project-build",
                },
            ]);
            const commands = new SlashCommandsModule(events, workflows, skills);
            await commands.beforeStart?.(database.context, agents);

            const catalog = await commands.catalog(database.context, "agent-1");
            expect(catalog).toHaveLength(MAX_SLASH_COMMANDS);
            expect(catalog).toContainEqual(
                expect.objectContaining({ kind: "skill", name: "review" }),
            );
            expect(catalog).toContainEqual(
                expect.objectContaining({ kind: "skill", name: "project-build" }),
            );
            expect(catalog).not.toContainEqual(expect.objectContaining({ name: "workflow-255" }));

            await commands.invoke(database.context, "agent-1", "review", invocation);
            expect(skills.invocations).toHaveLength(1);
            expect(workflows.invocations).toHaveLength(0);
        } finally {
            database.close();
        }
    });

    it("refreshes discovery from the before-turn hook", async () => {
        const events = new EventsModule();
        const database = moduleDatabase(events.migrations ?? [], "slash-command-turn-test");
        await database.ready;
        try {
            await events.beforeStart?.(database.context);
            const owner = new Contributor("feature", [
                { description: "First.", hasArguments: false, name: "first" },
            ]);
            const commands = new SlashCommandsModule(events, owner);
            const hooks = await commands.beforeStart?.(database.context, agents);
            await commands.refresh(database.context, "agent-1");
            owner.definitions = [{ description: "Second.", hasArguments: false, name: "second" }];

            await hooks?.beforeTurn?.(
                database.context,
                { agent: { id: "agent-1" } } as never,
                {} as never,
            );

            await expect(commands.catalog(database.context, "agent-1")).resolves.toMatchObject([
                { name: "second" },
            ]);
        } finally {
            database.close();
        }
    });
});
