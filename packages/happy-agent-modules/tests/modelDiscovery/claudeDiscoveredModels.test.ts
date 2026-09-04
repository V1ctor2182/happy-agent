import { describe, expect, it } from "vitest";

import {
    claudeDiscoveredModels,
    claudeVendorModelId,
} from "../../sources/modelDiscovery/impl/claudeDiscoveredModels.js";

const CLAUDE_ROUTE = {
    autoCompactWindow: 160_000,
    contextWindow: 200_000,
    defaultEffort: "medium",
    effortLevels: ["off", "low", "medium", "high", "xhigh", "max"],
};

describe("claudeVendorModelId", () => {
    it("maps a curated anthropic alias onto the vendor ID and leaves anything else alone", () => {
        expect(claudeVendorModelId("anthropic/opus-5")).toBe("claude-opus-5");
        expect(claudeVendorModelId("claude-mythos-5-1")).toBe("claude-mythos-5-1");
    });
});

describe("claudeDiscoveredModels", () => {
    const curated = new Set(["claude-opus-5", "claude-fable-5-1"]);
    const listing = [
        {
            id: "claude-mythos-5-1",
            display_name: "Claude Mythos 5.1",
            created_at: "2026-08-01T00:00:00Z",
            type: "model",
        },
        {
            id: "claude-opus-5-20260301",
            display_name: "Claude Opus 5",
            created_at: "2026-03-01T00:00:00Z",
            type: "model",
        },
        {
            id: "claude-haiku-4-5-20251001",
            display_name: "Claude Haiku 4.5",
            created_at: "2025-10-01T00:00:00Z",
            type: "model",
        },
        {
            id: "claude-haiku-4-5",
            display_name: "Claude Haiku 4.5",
            created_at: "2025-10-15T00:00:00Z",
            type: "model",
        },
        { id: "gpt-oss", display_name: "Not Claude", created_at: "2026-01-01T00:00:00Z" },
        {
            id: "claude-fable-5-1",
            display_name: "Claude Fable 5.1",
            created_at: "2026-09-01T00:00:00Z",
            type: "model",
        },
        "not an entry",
    ];

    it("offers the routes the curated catalog lacks, newest first, under the vendor ID", () => {
        expect(claudeDiscoveredModels(listing, curated)).toEqual([
            { ...CLAUDE_ROUTE, id: "claude-mythos-5-1", name: "Claude Mythos 5.1" },
            { ...CLAUDE_ROUTE, id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
        ]);
    });

    it("treats a dated snapshot of a curated model as that curated model", () => {
        const ids = claudeDiscoveredModels(listing, new Set(["claude-opus-5"])).map(
            (model) => model.id,
        );
        expect(ids).not.toContain("claude-opus-5-20260301");
        expect(ids).toContain("claude-fable-5-1");
    });

    it("names a route after its ID when the vendor gives it no display name", () => {
        expect(claudeDiscoveredModels([{ id: "claude-new" }], new Set())).toEqual([
            { ...CLAUDE_ROUTE, id: "claude-new", name: "claude-new" },
        ]);
    });
});
