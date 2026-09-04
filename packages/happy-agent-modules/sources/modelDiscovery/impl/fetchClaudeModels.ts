import type { HappyAgentConfigValues } from "../../config/index.js";
import { claudeDiscoveredModels } from "./claudeDiscoveredModels.js";
import type { ModelDiscoveryOutcome } from "./discoveryOutcome.js";
import { readClaudeCodeOAuthToken } from "./readClaudeCodeOAuthToken.js";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_MODELS_PATH = "/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";
/** Account-facing bearer tokens are only accepted alongside this beta, as the usage probe sends. */
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const CLAUDE_USER_AGENT = "claude-cli/2.0.0 (external, cli)";
const PAGE_SIZE = 1_000;
const MAX_PAGES = 10;

type ClaudeProviderRecord = Extract<
    HappyAgentConfigValues["providers"][string],
    { readonly type: "claude" }
>;

type ClaudeAuthorization =
    | { readonly kind: "api-key"; readonly value: string }
    | { readonly kind: "bearer"; readonly value: string };

export interface DiscoverClaudeModelsOptions {
    readonly provider: ClaudeProviderRecord;
    readonly env: NodeJS.ProcessEnv;
    readonly signal: AbortSignal;
    /** Vendor IDs the curated catalog already serves for this account. */
    readonly curatedVendorIds: ReadonlySet<string>;
}

/**
 * Ask one Claude account which models it serves, through Anthropic's model listing.
 *
 * The credential is chosen exactly as the account's provider chooses it: a configured OAuth
 * token, then an API key, then an auth token, then the Claude Code sign-in on this machine.
 */
export async function discoverClaudeModels(
    options: DiscoverClaudeModelsOptions,
): Promise<ModelDiscoveryOutcome> {
    const authorization = await claudeAuthorization(options.provider, options.env);
    if (authorization === undefined) return { status: "no-credentials" };
    const baseUrl = (options.env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_ANTHROPIC_BASE_URL).replace(
        /\/+$/u,
        "",
    );
    const entries: unknown[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(`${baseUrl}${ANTHROPIC_MODELS_PATH}`);
        url.searchParams.set("limit", String(PAGE_SIZE));
        if (after !== undefined) url.searchParams.set("after_id", after);
        const response = await fetch(url, {
            method: "GET",
            headers: claudeHeaders(authorization),
            signal: options.signal,
        });
        if (!response.ok) {
            return {
                status: "failed",
                error: `The Claude model listing returned HTTP ${String(response.status)}.`,
            };
        }
        const body = (await response.json()) as {
            readonly data?: unknown;
            readonly has_more?: unknown;
            readonly last_id?: unknown;
        } | null;
        if (!Array.isArray(body?.data)) {
            return { status: "failed", error: "The Claude model listing had an unexpected shape." };
        }
        entries.push(...body.data);
        if (
            body.has_more !== true ||
            typeof body.last_id !== "string" ||
            body.last_id.length === 0
        ) {
            break;
        }
        after = body.last_id;
    }
    return {
        status: "discovered",
        source: "anthropic",
        models: claudeDiscoveredModels(entries, options.curatedVendorIds),
    };
}

async function claudeAuthorization(
    provider: ClaudeProviderRecord,
    env: NodeJS.ProcessEnv,
): Promise<ClaudeAuthorization | undefined> {
    const ambient = provider.credentialIsolation !== true;
    const configured = (value: string | undefined, fallback: string | undefined) => {
        const explicit = value?.trim();
        if (explicit) return explicit;
        const discovered = ambient ? fallback?.trim() : undefined;
        return discovered ? discovered : undefined;
    };
    const oauthToken = configured(provider.oauthToken, env.CLAUDE_CODE_OAUTH_TOKEN);
    if (oauthToken !== undefined) return { kind: "bearer", value: oauthToken };
    const apiKey = configured(provider.apiKey, env.ANTHROPIC_API_KEY);
    if (apiKey !== undefined) return { kind: "api-key", value: apiKey };
    const authToken = configured(provider.authToken, env.ANTHROPIC_AUTH_TOKEN);
    if (authToken !== undefined) return { kind: "bearer", value: authToken };
    if (provider.configDir === undefined && !ambient) return undefined;
    const signIn = await readClaudeCodeOAuthToken({
        env: {
            ...env,
            ...(provider.configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: provider.configDir }),
        },
    });
    return signIn === undefined ? undefined : { kind: "bearer", value: signIn };
}

function claudeHeaders(authorization: ClaudeAuthorization): Record<string, string> {
    const shared = { accept: "application/json", "anthropic-version": ANTHROPIC_VERSION };
    if (authorization.kind === "api-key") return { ...shared, "x-api-key": authorization.value };
    return {
        ...shared,
        "anthropic-beta": OAUTH_BETA_HEADER,
        authorization: `Bearer ${authorization.value}`,
        "user-agent": CLAUDE_USER_AGENT,
    };
}
