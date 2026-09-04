import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CODEX_CHATGPT_ENDPOINT } from "@slopus/happy-providers";
import { createRootContext, withLifetime } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DurableFunctionsModule } from "../../sources/durableFunctions/index.js";
import {
    MODEL_DISCOVERY_STARTUP_DELAY_MS,
    ModelDiscoveryModule,
    type ModelDiscoveryEvent,
} from "../../sources/modelDiscovery/index.js";
import { testConfigRootedAt } from "../support/configModule.js";

const directories: string[] = [];

afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await Promise.all(
        directories.splice(0).map(async (directory) => {
            await rm(directory, { force: true, recursive: true });
        }),
    );
});

/** The answer the ChatGPT backend gives a signed-in Codex CLI, trimmed to what matters here. */
const codexListing = {
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
            service_tiers: [{ id: "priority" }],
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
                { effort: "low" },
                { effort: "medium" },
                { effort: "high" },
                { effort: "xhigh" },
                { effort: "max" },
            ],
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
    ],
};

const claudePages = [
    {
        data: [
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
        ],
        has_more: true,
        last_id: "claude-opus-5-20260301",
    },
    {
        data: [
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
        ],
        has_more: false,
        last_id: "claude-haiku-4-5",
    },
];

interface RecordedRequest {
    readonly headers: Headers;
    readonly url: URL;
}

interface DiscoveryWorld {
    readonly codexHome: string;
    readonly config: Awaited<ReturnType<typeof testConfigRootedAt>>;
    readonly events: ModelDiscoveryEvent[];
    readonly module: ModelDiscoveryModule;
    readonly reload: () => Promise<Awaited<ReturnType<typeof testConfigRootedAt>>>;
    readonly requests: RecordedRequest[];
}

interface DiscoveryWorldOptions {
    /** The Codex `auth.json`, or `null` for an account with nothing to sign in with. */
    readonly auth?: Record<string, unknown> | null;
    readonly codexStatus?: number;
    readonly codexToml?: readonly string[];
}

async function discoveryWorld(options: DiscoveryWorldOptions = {}): Promise<DiscoveryWorld> {
    const root = await mkdtemp(join(tmpdir(), "happy-model-discovery-"));
    directories.push(root);
    const codexHome = join(root, "codex");
    // Nothing on this PATH, so the module cannot spawn a real Codex CLI for its version.
    const emptyBin = join(root, "bin");
    await Promise.all([
        mkdir(codexHome, { recursive: true }),
        mkdir(emptyBin, { recursive: true }),
    ]);
    if (options.auth !== null) {
        await writeFile(
            join(codexHome, "auth.json"),
            JSON.stringify(
                options.auth ?? {
                    auth_mode: "chatgpt",
                    tokens: { access_token: "codex-access", account_id: "acct_1" },
                },
            ),
        );
    }
    const toml = [
        "[providers.codex]",
        "credential_isolation = true",
        `auth_file = ${JSON.stringify(join(codexHome, "auth.json"))}`,
        ...(options.codexToml ?? []),
        "[providers.claude]",
        "credential_isolation = true",
        'oauth_token = "claude-test-token"',
        "",
    ].join("\n");
    const load = async () =>
        await testConfigRootedAt(root, toml, { environment: { PATH: emptyBin } });
    const config = await load();
    const requests: RecordedRequest[] = [];
    let claudePage = 0;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        requests.push({ headers: new Headers(init.headers), url });
        if (url.href.startsWith(`${CODEX_CHATGPT_ENDPOINT}/codex/models`)) {
            if (options.codexStatus !== undefined) {
                return new Response("upstream trouble", { status: options.codexStatus });
            }
            return Response.json(codexListing);
        }
        if (url.origin === "https://api.anthropic.com" && url.pathname === "/v1/models") {
            const page = claudePages[Math.min(claudePage, claudePages.length - 1)];
            claudePage += 1;
            return Response.json(page);
        }
        return new Response("unexpected request", { status: 404 });
    });
    const module = new ModelDiscoveryModule(config, new DurableFunctionsModule());
    const events: ModelDiscoveryEvent[] = [];
    module.onEvent((event) => {
        events.push(event);
    });
    return { codexHome, config, events, module, reload: load, requests };
}

describe("ModelDiscoveryModule", () => {
    it("asks a ChatGPT sign-in for the Codex catalog, offers the new routes, and keeps them", async () => {
        const world = await discoveryWorld();
        const ctx = createRootContext().named("model-discovery-test");

        const status = await world.module.refresh(ctx, "codex");

        expect(status).toMatchObject({
            enabled: true,
            error: null,
            providerId: "codex",
            refreshedAt: expect.any(Number),
            source: "chatgpt",
        });
        expect(status.modelIds).toEqual([
            "openai/gpt-6-astra",
            "openai/gpt-5.6-sol",
            "openai/gpt-5.3-codex-spark",
        ]);
        const request = world.requests[0];
        expect(request?.headers.get("authorization")).toBe("Bearer codex-access");
        expect(request?.headers.get("chatgpt-account-id")).toBe("acct_1");
        expect(request?.url.searchParams.get("client_version")).toMatch(/^\d+\.\d+\.\d+$/u);

        const codexRoutes = world.config.catalog.filter((model) => model.providerId === "codex");
        expect(codexRoutes.filter((model) => model.id === "openai/gpt-5.6-sol")).toEqual([
            expect.objectContaining({ name: "GPT-5.6 Sol" }),
        ]);
        expect(codexRoutes.filter((model) => model.id === "openai/gpt-6-astra")).toEqual([
            expect.objectContaining({
                contextWindow: 400_000,
                defaultEffort: "high",
                effortLevels: ["low", "medium", "high", "xhigh"],
                name: "GPT-6 Astra",
                serviceTiers: ["priority"],
            }),
        ]);
        expect(world.events).toEqual([
            {
                added: expect.arrayContaining(["openai/gpt-6-astra", "openai/gpt-5.3-codex-spark"]),
                providerId: "codex",
                removed: [],
                source: "chatgpt",
                type: "catalog_changed",
            },
        ]);
        expect(world.module.list().find((entry) => entry.providerId === "codex")).toEqual(status);

        // The same answer again changes nothing and tells nobody.
        await world.module.refresh(ctx, "codex");
        expect(world.events).toHaveLength(1);

        void world.config.providerIds;
        world.config.setProviderEnabled("codex", true);
        expect(world.config.modelContext("codex", "openai/gpt-5.3-codex-spark")).toEqual({
            autoCompactWindow: 115_200,
            contextWindow: 128_000,
        });

        // The answer is durable: the next load offers the routes before asking anyone.
        const persisted = JSON.parse(
            await readFile(world.config.configuration.paths.discoveredModelsPath, "utf8"),
        ) as { readonly providers: Record<string, { readonly source: string }> };
        expect(persisted.providers["codex"]?.source).toBe("chatgpt");
        const reloaded = await world.reload();
        expect(reloaded.discoveredCatalog("codex")?.source).toBe("chatgpt");
        expect(reloaded.offeredModels.map((model) => model.id)).toContain("openai/gpt-6-astra");
    });

    it("pages through a Claude account's listing with its OAuth token and keeps the vendor IDs", async () => {
        const world = await discoveryWorld();
        const ctx = createRootContext().named("model-discovery-test");

        const status = await world.module.refresh(ctx, "claude");

        expect(status).toMatchObject({ enabled: true, error: null, source: "anthropic" });
        expect(status.modelIds).toContain("claude-mythos-5-1");
        expect(status.modelIds).toContain("claude-haiku-4-5");
        expect(status.modelIds).not.toContain("claude-haiku-4-5-20251001");
        expect(status.modelIds).not.toContain("claude-opus-5-20260301");

        const anthropic = world.requests.filter(
            (request) => request.url.hostname === "api.anthropic.com",
        );
        expect(anthropic.map((request) => request.url.searchParams.get("after_id"))).toEqual([
            null,
            "claude-opus-5-20260301",
        ]);
        const first = anthropic[0];
        expect(first?.headers.get("authorization")).toBe("Bearer claude-test-token");
        expect(first?.headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
        expect(first?.headers.get("anthropic-version")).toBe("2023-06-01");
        expect(first?.headers.get("x-api-key")).toBeNull();

        expect(world.config.catalog).toContainEqual(
            expect.objectContaining({
                id: "claude-mythos-5-1",
                name: "Claude Mythos 5.1",
                providerId: "claude",
            }),
        );
        expect(world.events).toEqual([
            expect.objectContaining({
                providerId: "claude",
                source: "anthropic",
                type: "catalog_changed",
            }),
        ]);
    });

    it("falls back to the Codex CLI cache beside the auth file when the listing fails", async () => {
        const world = await discoveryWorld({ codexStatus: 500 });
        await writeFile(
            join(world.codexHome, "models_cache.json"),
            JSON.stringify({
                client_version: "0.150.0",
                models: [codexListing.models[3]],
            }),
        );
        const ctx = createRootContext().named("model-discovery-test");

        const status = await world.module.refresh(ctx, "codex");

        expect(status).toMatchObject({ error: null, source: "codex-cache" });
        expect(status.modelIds).toEqual(["openai/gpt-5.3-codex-spark"]);
        expect(world.events).toHaveLength(1);
    });

    it("records why an account could not be asked and changes nothing", async () => {
        const failed = await discoveryWorld({ codexStatus: 503 });
        const ctx = createRootContext().named("model-discovery-test");

        expect(await failed.module.refresh(ctx, "codex")).toMatchObject({
            error: "The Codex model listing returned HTTP 503.",
            modelIds: [],
            refreshedAt: null,
            source: null,
        });
        expect(failed.events).toEqual([]);
        expect(failed.config.discoveredCatalog("codex")).toBeUndefined();
        await expect(
            stat(failed.config.configuration.paths.discoveredModelsPath),
        ).rejects.toThrow();

        const unsigned = await discoveryWorld({ auth: null });
        expect(await unsigned.module.refresh(ctx, "codex")).toMatchObject({
            enabled: true,
            error: "The account has no credentials to ask with.",
            modelIds: [],
        });
        expect(unsigned.requests).toEqual([]);
    });

    it("asks every discoverable account shortly after the agent starts, then keeps asking", async () => {
        const world = await discoveryWorld();
        vi.useFakeTimers();
        const stop = new AbortController();
        const ctx = withLifetime(createRootContext().named("model-discovery-test"), stop.signal);
        try {
            world.module.beforeStart(ctx);
            world.module.beforeStart(ctx);
            expect(world.requests).toEqual([]);

            await vi.advanceTimersByTimeAsync(MODEL_DISCOVERY_STARTUP_DELAY_MS);
            await vi.waitFor(() => {
                expect(world.events.map((event) => event.providerId).sort()).toEqual([
                    "claude",
                    "codex",
                ]);
            });
            const asked = world.requests.length;
            expect(
                world.requests.filter((request) => request.url.hostname === "chatgpt.com"),
            ).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
            await vi.waitFor(() => {
                expect(world.requests.length).toBeGreaterThan(asked);
            });
            // The same answers again: nothing new to announce.
            expect(world.events).toHaveLength(2);
        } finally {
            stop.abort();
            vi.useRealTimers();
        }
    });

    it("leaves an account alone when discovery is switched off for it", async () => {
        const world = await discoveryWorld({ codexToml: ["discover_models = false"] });
        const ctx = createRootContext().named("model-discovery-test");

        expect(
            Object.fromEntries(
                world.module.list().map((entry) => [entry.providerId, entry.enabled]),
            ),
        ).toEqual({ bedrock: false, claude: true, codex: false, grok: false });
        await expect(world.module.request(ctx, "codex")).resolves.toBeUndefined();
        expect(await world.module.refresh(ctx, "codex")).toMatchObject({
            enabled: false,
            error: null,
            modelIds: [],
        });
        expect(world.requests).toEqual([]);
        await expect(world.module.refresh(ctx, "nobody")).rejects.toThrow(
            'Provider "nobody" is not configured.',
        );
    });
});
