import { Type } from "@sinclair/typebox";
import type { AgentModule } from "@slopus/happy-agent-base";
import { delay, forever, isAbortedError, type Context } from "@steve.kite/stdlib";

import {
    ConfigModule,
    type DiscoveredModelSource,
    type DiscoveredProviderCatalog,
} from "../config/index.js";
import { DurableFunctionsModule } from "../durableFunctions/index.js";
import { claudeVendorModelId } from "./impl/claudeDiscoveredModels.js";
import type { ModelDiscoveryOutcome } from "./impl/discoveryOutcome.js";
import { discoverClaudeModels } from "./impl/fetchClaudeModels.js";
import { discoverCodexModels, readCodexClientVersion } from "./impl/fetchCodexModels.js";

/** How often a signed-in account is asked again for the models it serves. */
export const MODEL_DISCOVERY_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;
/** The startup pass finishes first; the first vendor request follows shortly after. */
export const MODEL_DISCOVERY_STARTUP_DELAY_MS = 5_000;
const MODEL_DISCOVERY_REQUEST_TIMEOUT_MS = 20_000;
const MODEL_DISCOVERY_FUNCTION = "model-discovery.refresh";

const refreshArgumentsSchema = Type.Object(
    { providerId: Type.String({ minLength: 1, maxLength: 256 }) },
    { additionalProperties: false },
);
const refreshResultSchema = Type.Null();

export interface ModelDiscoveryEvent {
    readonly type: "catalog_changed";
    readonly providerId: string;
    readonly source: DiscoveredModelSource;
    /** Discovered route IDs that were not in the account's previous discovered list. */
    readonly added: readonly string[];
    /** Discovered route IDs the account no longer lists. */
    readonly removed: readonly string[];
}

export interface ModelDiscoveryStatus {
    readonly providerId: string;
    /** Whether configuration lets this account be asked at all. */
    readonly enabled: boolean;
    /** When the account last answered, in this process or one before it. */
    readonly refreshedAt: number | null;
    readonly source: DiscoveredModelSource | null;
    /** Every route the account currently lists, curated ones included. */
    readonly modelIds: readonly string[];
    /** Why the latest refresh changed nothing, when it could not ask. */
    readonly error: string | null;
}

/**
 * Keeps each signed-in Codex and Claude account's model list current.
 *
 * The curated catalog in configuration is the floor: it names the routes Happy Agent knows with
 * hand-checked wire details. This module asks the account itself which models it serves and hands
 * the answer to configuration, which appends the routes the curated list lacks. It asks in the
 * background: a few seconds after the agent system is up, on a timer from then on, and when the
 * API learns an account became usable. Nothing here runs on the startup path or while a session
 * is created, and a failed request leaves the last durable answer in place.
 */
export class ModelDiscoveryModule implements AgentModule {
    readonly name = "model-discovery";

    readonly #config: ConfigModule;
    readonly #durableFunctions: DurableFunctionsModule;
    readonly #listeners = new Set<(event: ModelDiscoveryEvent) => void>();
    readonly #inFlight = new Map<string, Promise<ModelDiscoveryStatus>>();
    readonly #errors = new Map<string, string>();
    readonly #loops: Promise<void>[] = [];
    #codexClientVersion: Promise<string> | undefined;
    #started = false;

    constructor(config: ConfigModule, durableFunctions: DurableFunctionsModule) {
        this.#config = config;
        this.#durableFunctions = durableFunctions;
        durableFunctions.register({
            name: MODEL_DISCOVERY_FUNCTION,
            argumentsSchema: refreshArgumentsSchema,
            resultSchema: refreshResultSchema,
            executor: async (ctx, call) => {
                await this.refresh(ctx, call.arguments.providerId);
                return null;
            },
        });
    }

    readonly beforeStart = (ctx: Context): void => {
        if (this.#started) return;
        this.#started = true;
        for (const providerId of this.#config.providerIds) {
            if (!this.#config.modelDiscoveryEnabled(providerId)) continue;
            const name = `model-discovery:${providerId}`;
            let first = true;
            const loop = forever(
                ctx,
                { delay: MODEL_DISCOVERY_REFRESH_INTERVAL_MS, delayFirst: false, name },
                async (loopCtx) => {
                    if (first) {
                        first = false;
                        await delay(loopCtx, MODEL_DISCOVERY_STARTUP_DELAY_MS);
                    }
                    await this.refresh(loopCtx, providerId);
                },
            ).catch((error: unknown) => {
                if (!isAbortedError(error)) {
                    ctx.log.warn(`Model discovery stopped for "${providerId}".`, {}, error);
                }
            });
            this.#loops.push(loop);
        }
    };

    /** Watch for an account's discovered list changing. Returns the function that stops watching. */
    onEvent(listener: (event: ModelDiscoveryEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /** Every configured account, including those that are never asked. */
    list(): readonly ModelDiscoveryStatus[] {
        return this.#config.providerIds.map((providerId) => this.#status(providerId));
    }

    /**
     * Durably ask for one account's list. The call survives a restart and joins a pending request
     * for the same account instead of queueing a second one.
     */
    async request(ctx: Context, providerId: string): Promise<void> {
        if (!this.#config.modelDiscoveryEnabled(providerId)) return;
        await this.#durableFunctions.invoke(ctx, {
            function: MODEL_DISCOVERY_FUNCTION,
            arguments: { providerId },
            operationId: `model-discovery:${providerId}`,
            lockKeys: [`model-discovery:${providerId}`],
        });
    }

    /** Ask one account now, or join the request already on its way. */
    async refresh(ctx: Context, providerId: string): Promise<ModelDiscoveryStatus> {
        const running = this.#inFlight.get(providerId);
        if (running !== undefined) return await running;
        const work = this.#performRefresh(ctx, providerId).finally(() => {
            if (this.#inFlight.get(providerId) === work) this.#inFlight.delete(providerId);
        });
        this.#inFlight.set(providerId, work);
        return await work;
    }

    async #performRefresh(ctx: Context, providerId: string): Promise<ModelDiscoveryStatus> {
        const provider = this.#config.configuration.values.providers[providerId];
        if (provider === undefined) {
            throw new Error(`Provider "${providerId}" is not configured.`);
        }
        if (!this.#config.modelDiscoveryEnabled(providerId)) return this.#status(providerId);
        const env = this.#config.providerEnvironment(providerId);
        const signal = requestSignal(ctx);
        let outcome: ModelDiscoveryOutcome;
        try {
            outcome =
                provider.type === "codex"
                    ? await discoverCodexModels({
                          clientVersion: () => this.#resolveCodexClientVersion(env),
                          env,
                          provider,
                          signal,
                      })
                    : provider.type === "claude"
                      ? await discoverClaudeModels({
                            curatedVendorIds: this.#curatedClaudeVendorIds(providerId),
                            env,
                            provider,
                            signal,
                        })
                      : { status: "no-credentials" };
        } catch (error: unknown) {
            outcome = { status: "failed", error: errorMessage(error) };
        }
        if (outcome.status === "no-credentials") {
            this.#errors.set(providerId, "The account has no credentials to ask with.");
            return this.#status(providerId);
        }
        if (outcome.status === "failed") {
            this.#errors.set(providerId, outcome.error);
            ctx.log.debug(`model-discovery:failed provider=${providerId} error=${outcome.error}`);
            return this.#status(providerId);
        }
        const previous = this.#config.discoveredCatalog(providerId);
        const catalog: DiscoveredProviderCatalog = {
            fetchedAt: Date.now(),
            models: [...outcome.models],
            source: outcome.source,
        };
        const changed = await this.#config.updateDiscoveredModels(ctx, providerId, catalog);
        this.#errors.delete(providerId);
        if (changed) {
            const before = new Set(previous?.models.map((model) => model.id) ?? []);
            const after = new Set(catalog.models.map((model) => model.id));
            const added = [...after].filter((id) => !before.has(id));
            const removed = [...before].filter((id) => !after.has(id));
            ctx.log.info(
                `model-discovery:updated provider=${providerId} source=${catalog.source} models=${String(after.size)} added=${added.join(",")} removed=${removed.join(",")}`,
            );
            this.#emit({
                type: "catalog_changed",
                providerId,
                source: catalog.source,
                added,
                removed,
            });
        }
        return this.#status(providerId);
    }

    #status(providerId: string): ModelDiscoveryStatus {
        const catalog = this.#config.discoveredCatalog(providerId);
        return {
            enabled: this.#config.modelDiscoveryEnabled(providerId),
            error: this.#errors.get(providerId) ?? null,
            modelIds: catalog?.models.map((model) => model.id) ?? [],
            providerId,
            refreshedAt: catalog?.fetchedAt ?? null,
            source: catalog?.source ?? null,
        };
    }

    /** The vendor IDs behind this account's curated `anthropic/…` routes, so a listing never doubles them. */
    #curatedClaudeVendorIds(providerId: string): ReadonlySet<string> {
        return new Set(
            this.#config.catalog
                .filter(
                    (model) => model.providerId === providerId && model.id.startsWith("anthropic/"),
                )
                .map((model) => claudeVendorModelId(model.id)),
        );
    }

    #resolveCodexClientVersion(env: NodeJS.ProcessEnv): Promise<string> {
        this.#codexClientVersion ??= readCodexClientVersion(env);
        return this.#codexClientVersion;
    }

    /** A listener is bookkeeping beside discovery; one that throws never loses the discovery. */
    #emit(event: ModelDiscoveryEvent): void {
        for (const listener of this.#listeners) {
            try {
                listener(event);
            } catch {
                // The discovered list is already durable; a listener decides nothing about it.
            }
        }
    }
}

function requestSignal(ctx: Context): AbortSignal {
    const timeout = AbortSignal.timeout(MODEL_DISCOVERY_REQUEST_TIMEOUT_MS);
    return ctx.lifetime === undefined ? timeout : AbortSignal.any([timeout, ctx.lifetime]);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
