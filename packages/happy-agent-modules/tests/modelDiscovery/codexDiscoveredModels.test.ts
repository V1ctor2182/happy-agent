import { describe, expect, it } from "vitest";

import { codexDiscoveredModels } from "../../sources/modelDiscovery/impl/codexDiscoveredModels.js";

/** The shape the ChatGPT backend and the Codex CLI's `models_cache.json` share. */
const listing = {
    client_version: "0.153.2",
    models: [
        {
            slug: "gpt-6-astra",
            display_name: "GPT-6 Astra",
            visibility: "list",
            default_reasoning_level: "high",
            supported_reasoning_levels: [
                { effort: "low" },
                { effort: "medium" },
                { effort: "high" },
                { effort: "xhigh" },
                { effort: "ultra" },
            ],
            service_tiers: [{ id: "priority" }, { id: "flex" }],
            context_window: 400_000,
            priority: 0,
        },
        {
            slug: "gpt-reserve",
            display_name: "Reserve",
            visibility: "hide",
            supported_reasoning_levels: [{ effort: "medium" }],
            priority: 1,
        },
        {
            slug: "gpt-5.6-sol",
            display_name: "GPT-5.6 Sol",
            visibility: "list",
            default_reasoning_level: "medium",
            supported_reasoning_levels: [
                { effort: "none" },
                { effort: "low" },
                { effort: "medium" },
                { effort: "high" },
            ],
            service_tiers: [],
            priority: 2,
        },
        {
            slug: "gpt-5.3-codex-spark",
            display_name: "GPT-5.3 Codex Spark",
            visibility: "list",
            supported_reasoning_levels: [{ effort: "medium" }],
            context_window: 128_000,
            priority: 3,
        },
        {
            slug: "vendor/other",
            visibility: "list",
            supported_reasoning_levels: [{ effort: "medium" }],
        },
        {
            slug: "no-efforts",
            visibility: "list",
            supported_reasoning_levels: [{ effort: "ultra" }],
        },
    ],
};

describe("codexDiscoveredModels", () => {
    it("offers the visible models with Happy's efforts, tiers, and windows in vendor order", () => {
        expect(codexDiscoveredModels(listing)).toEqual([
            {
                autoCompactWindow: 360_000,
                contextWindow: 400_000,
                defaultEffort: "high",
                effortLevels: ["low", "medium", "high", "xhigh"],
                id: "openai/gpt-6-astra",
                name: "GPT-6 Astra",
                serviceTiers: ["priority"],
            },
            {
                autoCompactWindow: 244_800,
                contextWindow: 272_000,
                defaultEffort: "medium",
                effortLevels: ["off", "low", "medium", "high"],
                id: "openai/gpt-5.6-sol",
                name: "GPT-5.6 Sol",
            },
            {
                autoCompactWindow: 115_200,
                contextWindow: 128_000,
                defaultEffort: "medium",
                effortLevels: ["medium"],
                id: "openai/gpt-5.3-codex-spark",
                name: "GPT-5.3 Codex Spark",
            },
        ]);
    });

    it("falls back to the first offered effort when the vendor default is not one Happy offers", () => {
        const models = codexDiscoveredModels({
            models: [
                {
                    slug: "gpt-x",
                    default_reasoning_level: "ultra",
                    supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
                },
            ],
        });
        expect(models).toEqual([
            {
                autoCompactWindow: 244_800,
                contextWindow: 272_000,
                defaultEffort: "low",
                effortLevels: ["low"],
                id: "openai/gpt-x",
                name: "gpt-x",
            },
        ]);
    });

    it("orders a model without a priority after every prioritized one", () => {
        const models = codexDiscoveredModels({
            models: [
                { slug: "b-unranked", supported_reasoning_levels: ["medium"] },
                { slug: "a-unranked", supported_reasoning_levels: ["medium"] },
                { slug: "ranked", supported_reasoning_levels: ["medium"], priority: 5 },
            ],
        });
        expect(models?.map((model) => model.id)).toEqual([
            "openai/ranked",
            "openai/a-unranked",
            "openai/b-unranked",
        ]);
    });

    it("tells a payload that is not a listing apart from a listing with nothing usable", () => {
        expect(codexDiscoveredModels(null)).toBeUndefined();
        expect(codexDiscoveredModels({ data: [] })).toBeUndefined();
        expect(codexDiscoveredModels({ models: "nope" })).toBeUndefined();
        expect(codexDiscoveredModels({ models: [] })).toEqual([]);
        expect(codexDiscoveredModels({ models: [{ slug: "hidden", visibility: "hide" }] })).toEqual(
            [],
        );
    });
});
