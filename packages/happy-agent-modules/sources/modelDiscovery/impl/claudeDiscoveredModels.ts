import type { DiscoveredAgentModel } from "../../config/index.js";

/** The curated Claude routes offer every effort with a medium default; discovered ones match. */
const CLAUDE_EFFORTS: DiscoveredAgentModel["effortLevels"] = [
    "off",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
];
/**
 * Anthropic's listing carries no context size. Every current Claude model serves at least 200k,
 * and only the curated entries know which ones may be asked for the 1M window.
 */
const CLAUDE_CONTEXT_WINDOW = 200_000;
const CLAUDE_AUTO_COMPACT_WINDOW = 160_000;
const CLAUDE_MODEL_PREFIX = "claude-";
const HAPPY_ANTHROPIC_PREFIX = "anthropic/";

interface AnthropicModelEntry {
    readonly created_at?: unknown;
    readonly display_name?: unknown;
    readonly id?: unknown;
}

/** The vendor ID one curated `anthropic/…` route resolves to, without any context-window suffix. */
export function claudeVendorModelId(happyModelId: string): string {
    return happyModelId.startsWith(HAPPY_ANTHROPIC_PREFIX)
        ? `${CLAUDE_MODEL_PREFIX}${happyModelId.slice(HAPPY_ANTHROPIC_PREFIX.length)}`
        : happyModelId;
}

/**
 * The routes in one Anthropic `/v1/models` listing that the curated catalog does not already
 * serve, newest first.
 *
 * Discovered Claude routes keep the vendor's own ID. The provider package maps only the curated
 * `anthropic/…` aliases and hands every other ID to Claude Code unchanged, so the vendor ID is
 * the one that actually runs. A dated snapshot of a curated model counts as that model, and when
 * the vendor lists one model under several IDs, the newest one stands for it.
 */
export function claudeDiscoveredModels(
    entries: readonly unknown[],
    curatedVendorIds: ReadonlySet<string>,
): DiscoveredAgentModel[] {
    const byName = new Map<
        string,
        { readonly createdAt: number; readonly model: DiscoveredAgentModel }
    >();
    for (const entry of entries) {
        if (typeof entry !== "object" || entry === null) continue;
        const model = entry as AnthropicModelEntry;
        const id = typeof model.id === "string" ? model.id.trim() : "";
        if (!id.startsWith(CLAUDE_MODEL_PREFIX)) continue;
        if (curatedVendorIds.has(id) || curatedVendorIds.has(withoutSnapshotDate(id))) continue;
        const displayName = typeof model.display_name === "string" ? model.display_name.trim() : "";
        const name = displayName.length > 0 ? displayName : id;
        const createdAt =
            typeof model.created_at === "string" ? Date.parse(model.created_at) : Number.NaN;
        const candidate = {
            createdAt: Number.isFinite(createdAt) ? createdAt : 0,
            model: {
                autoCompactWindow: CLAUDE_AUTO_COMPACT_WINDOW,
                contextWindow: CLAUDE_CONTEXT_WINDOW,
                defaultEffort: "medium" as const,
                effortLevels: [...CLAUDE_EFFORTS],
                id,
                name,
            },
        };
        const key = name.toLowerCase();
        const existing = byName.get(key);
        if (existing === undefined || candidate.createdAt > existing.createdAt)
            byName.set(key, candidate);
    }
    return [...byName.values()]
        .sort(
            (left, right) =>
                right.createdAt - left.createdAt || left.model.id.localeCompare(right.model.id),
        )
        .map((item) => item.model);
}

function withoutSnapshotDate(id: string): string {
    return id.replace(/-\d{8}$/u, "");
}
