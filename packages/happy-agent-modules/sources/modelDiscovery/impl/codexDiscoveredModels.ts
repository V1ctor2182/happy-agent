import type { DiscoveredAgentModel } from "../../config/index.js";

type DiscoveredEffort = DiscoveredAgentModel["effortLevels"][number];

/** Codex reports 272k for every current model; a listing that omits the window gets the same. */
const DEFAULT_CODEX_CONTEXT_WINDOW = 272_000;
/** The curated Codex entries compact at 90% of the window; discovered ones follow suit. */
const AUTO_COMPACT_RATIO = 0.9;

/** Codex effort names in Happy's vocabulary. Anything else, such as `ultra`, is not offered. */
const CODEX_EFFORTS: Readonly<Record<string, DiscoveredEffort>> = Object.freeze({
    high: "high",
    low: "low",
    max: "max",
    medium: "medium",
    minimal: "minimal",
    none: "off",
    off: "off",
    xhigh: "xhigh",
});

interface CodexModelEntry {
    readonly context_window?: unknown;
    readonly default_reasoning_level?: unknown;
    readonly display_name?: unknown;
    readonly priority?: unknown;
    readonly service_tiers?: unknown;
    readonly slug?: unknown;
    readonly supported_reasoning_levels?: unknown;
    readonly visibility?: unknown;
}

/**
 * The picker-worthy routes in one Codex `/models` answer, in the vendor's own order.
 *
 * The same shape sits in the Codex CLI's `models_cache.json`, so a cache file reads through here
 * too. Returns nothing when the payload is not a models response at all, which is different from
 * a response that lists no usable model.
 */
export function codexDiscoveredModels(payload: unknown): DiscoveredAgentModel[] | undefined {
    const models = (payload as { readonly models?: unknown } | null)?.models;
    if (!Array.isArray(models)) return undefined;
    const listed: { readonly priority: number; readonly model: DiscoveredAgentModel }[] = [];
    for (const entry of models) {
        const model = codexDiscoveredModel(entry);
        if (model === undefined) continue;
        const priority = (entry as CodexModelEntry).priority;
        listed.push({
            model,
            priority:
                typeof priority === "number" && Number.isFinite(priority)
                    ? priority
                    : Number.MAX_SAFE_INTEGER,
        });
    }
    listed.sort(
        (left, right) =>
            left.priority - right.priority || left.model.id.localeCompare(right.model.id),
    );
    return listed.map((item) => item.model);
}

function codexDiscoveredModel(entry: unknown): DiscoveredAgentModel | undefined {
    if (typeof entry !== "object" || entry === null) return undefined;
    const model = entry as CodexModelEntry;
    const slug = typeof model.slug === "string" ? model.slug.trim() : "";
    if (slug.length === 0 || slug.includes("/")) return undefined;
    // A hidden model is one the vendor's own picker does not show, such as its review model.
    if (model.visibility !== undefined && model.visibility !== "list") return undefined;
    const effortLevels = codexEfforts(model.supported_reasoning_levels);
    if (effortLevels.length === 0) return undefined;
    const requestedDefault =
        typeof model.default_reasoning_level === "string"
            ? CODEX_EFFORTS[model.default_reasoning_level]
            : undefined;
    const defaultEffort =
        requestedDefault !== undefined && effortLevels.includes(requestedDefault)
            ? requestedDefault
            : effortLevels[0]!;
    const serviceTiers = codexServiceTiers(model.service_tiers);
    const contextWindow = positiveInteger(model.context_window) ?? DEFAULT_CODEX_CONTEXT_WINDOW;
    const displayName = typeof model.display_name === "string" ? model.display_name.trim() : "";
    return {
        autoCompactWindow: Math.floor(contextWindow * AUTO_COMPACT_RATIO),
        contextWindow,
        defaultEffort,
        effortLevels,
        id: `openai/${slug}`,
        name: displayName.length > 0 ? displayName : slug,
        ...(serviceTiers.length === 0 ? {} : { serviceTiers }),
    };
}

function codexEfforts(value: unknown): DiscoveredEffort[] {
    if (!Array.isArray(value)) return [];
    const efforts: DiscoveredEffort[] = [];
    for (const level of value) {
        const name =
            typeof level === "string"
                ? level
                : typeof level === "object" && level !== null
                  ? (level as { readonly effort?: unknown }).effort
                  : undefined;
        const effort = typeof name === "string" ? CODEX_EFFORTS[name] : undefined;
        if (effort !== undefined && !efforts.includes(effort)) efforts.push(effort);
    }
    return efforts;
}

function codexServiceTiers(value: unknown): DiscoveredAgentModel["serviceTiers"] & unknown[] {
    if (!Array.isArray(value)) return [];
    const tiers: "priority"[] = [];
    for (const tier of value) {
        const id =
            typeof tier === "string"
                ? tier
                : typeof tier === "object" && tier !== null
                  ? (tier as { readonly id?: unknown }).id
                  : undefined;
        if (id === "priority" && !tiers.includes(id)) tiers.push(id);
    }
    return tiers;
}

function positiveInteger(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}
