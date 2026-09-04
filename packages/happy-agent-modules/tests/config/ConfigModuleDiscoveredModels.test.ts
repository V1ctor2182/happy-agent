import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createRootContext } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it } from "vitest";

import type { DiscoveredAgentModel } from "../../sources/config/index.js";
import { testConfigRootedAt } from "../support/configModule.js";

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(async (directory) => {
            await rm(directory, { force: true, recursive: true });
        }),
    );
});

async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "happy-discovered-models-"));
    directories.push(root);
    return root;
}

const astra: DiscoveredAgentModel = {
    autoCompactWindow: 360_000,
    contextWindow: 400_000,
    defaultEffort: "high",
    effortLevels: ["low", "medium", "high", "xhigh"],
    id: "openai/gpt-6-astra",
    name: "GPT-6 Astra",
    serviceTiers: ["priority"],
};

const renamedSol: DiscoveredAgentModel = {
    autoCompactWindow: 244_800,
    contextWindow: 272_000,
    defaultEffort: "medium",
    effortLevels: ["medium"],
    id: "openai/gpt-5.6-sol",
    name: "Renamed by the vendor",
};

describe("ConfigModule discovered models", () => {
    it("appends discovered routes after the curated ones and lets a curated route win its ID", async () => {
        const root = await temporaryRoot();
        const config = await testConfigRootedAt(
            root,
            "[providers.codex]\ncredential_isolation = true\n",
        );
        const ctx = createRootContext().named("discovered-models-test");

        expect(config.discoveredCatalog("codex")).toBeUndefined();
        expect(
            await config.updateDiscoveredModels(ctx, "codex", {
                fetchedAt: 1_000,
                models: [astra, renamedSol],
                source: "chatgpt",
            }),
        ).toBe(true);
        expect(
            await config.updateDiscoveredModels(ctx, "codex", {
                fetchedAt: 2_000,
                models: [astra, renamedSol],
                source: "chatgpt",
            }),
        ).toBe(false);

        const codexRoutes = config.catalog.filter((model) => model.providerId === "codex");
        const sol = codexRoutes.filter((model) => model.id === "openai/gpt-5.6-sol");
        expect(sol).toHaveLength(1);
        expect(sol[0]?.name).toBe("GPT-5.6 Sol");
        expect(codexRoutes.at(-1)).toMatchObject({
            contextWindow: 400_000,
            id: "openai/gpt-6-astra",
            name: "GPT-6 Astra",
            serviceTiers: ["priority"],
        });
        expect(codexRoutes.findIndex((model) => model.id === "openai/gpt-6-astra")).toBeGreaterThan(
            codexRoutes.findIndex((model) => model.id === "openai/gpt-5.6-sol"),
        );

        void config.providerIds;
        config.setProviderEnabled("codex", true);
        expect(config.models.map((model) => model.id)).toContain("openai/gpt-6-astra");
        expect(config.modelContext("codex", "openai/gpt-6-astra")).toEqual({
            autoCompactWindow: 360_000,
            contextWindow: 400_000,
        });

        const persisted = JSON.parse(
            await readFile(config.configuration.paths.discoveredModelsPath, "utf8"),
        ) as {
            readonly providers: Record<string, { readonly fetchedAt: number }>;
            readonly version: number;
        };
        expect(persisted.version).toBe(1);
        expect(persisted.providers["codex"]?.fetchedAt).toBe(2_000);
    });

    it("offers the persisted discovered routes at the next load without asking anyone", async () => {
        const root = await temporaryRoot();
        const first = await testConfigRootedAt(
            root,
            "[providers.codex]\ncredential_isolation = true\n",
        );
        const path = first.configuration.paths.discoveredModelsPath;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
            path,
            JSON.stringify({
                providers: { codex: { fetchedAt: 5, models: [astra], source: "codex-cache" } },
                version: 1,
            }),
        );

        const config = await testConfigRootedAt(
            root,
            "[providers.codex]\ncredential_isolation = true\n",
        );
        expect(config.discoveredCatalog("codex")).toMatchObject({
            fetchedAt: 5,
            source: "codex-cache",
        });
        expect(config.offeredModels.map((model) => model.id)).toContain("openai/gpt-6-astra");
    });

    it("applies the account's exclusions to discovered routes too", async () => {
        const root = await temporaryRoot();
        const config = await testConfigRootedAt(
            root,
            '[providers.codex]\ncredential_isolation = true\nexclude_models = ["openai/gpt-6-astra"]\n',
        );
        await config.updateDiscoveredModels(createRootContext(), "codex", {
            fetchedAt: 1,
            models: [astra],
            source: "chatgpt",
        });
        expect(config.offeredModels.map((model) => model.id)).not.toContain("openai/gpt-6-astra");
    });

    it("ignores a persisted file it cannot read and starts from the curated catalog", async () => {
        const root = await temporaryRoot();
        const first = await testConfigRootedAt(root);
        const path = first.configuration.paths.discoveredModelsPath;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "{ not json");

        const config = await testConfigRootedAt(root);
        expect(config.discoveredCatalog("codex")).toBeUndefined();
        expect(config.offeredModels.map((model) => model.id)).toContain("openai/gpt-5.6-sol");
    });

    it("refuses a discovered catalog for an account that is not configured", async () => {
        const root = await temporaryRoot();
        const config = await testConfigRootedAt(root);
        await expect(
            config.updateDiscoveredModels(createRootContext(), "nobody", {
                fetchedAt: 1,
                models: [],
                source: "chatgpt",
            }),
        ).rejects.toThrow('Provider "nobody" is not configured.');
    });
});
