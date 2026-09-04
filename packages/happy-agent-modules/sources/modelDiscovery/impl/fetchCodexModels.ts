import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
    CODEX_CHATGPT_ENDPOINT,
    CodexApiKeyCredential,
    CodexSessionCredential,
    loadCodexCredential,
} from "@slopus/happy-providers";

import type { DiscoveredAgentModel, HappyAgentConfigValues } from "../../config/index.js";
import { codexDiscoveredModels } from "./codexDiscoveredModels.js";
import type { ModelDiscoveryOutcome } from "./discoveryOutcome.js";

const execFileAsync = promisify(execFile);

/** The ChatGPT backend's Codex catalog, the same request the Codex CLI makes for its picker. */
const CODEX_MODELS_PATH = "/codex/models";
const CODEX_MODEL_CACHE_FILE = "models_cache.json";
const CODEX_VERSION_TIMEOUT_MS = 3_000;
/** The newest Codex CLI release known when this was written; an installed CLI's own version wins. */
export const DEFAULT_CODEX_CLIENT_VERSION = "0.153.2";

type CodexProviderRecord = Extract<
    HappyAgentConfigValues["providers"][string],
    { readonly type: "codex" }
>;
type CodexCredential = Awaited<ReturnType<typeof loadCodexCredential>>;

export interface DiscoverCodexModelsOptions {
    readonly provider: CodexProviderRecord;
    readonly env: NodeJS.ProcessEnv;
    readonly signal: AbortSignal;
    /** The client version the backend is told, resolved lazily because it may spawn the CLI. */
    readonly clientVersion: () => Promise<string>;
}

export interface CodexModelCache {
    readonly clientVersion: string | undefined;
    readonly models: readonly DiscoveredAgentModel[] | undefined;
}

/**
 * Ask one Codex account which models it serves.
 *
 * A ChatGPT sign-in is asked directly. An API key has no catalog endpoint, and a failed request
 * must not empty the picker, so both fall back to the Codex CLI's own cache of the same answer
 * when the account can see one.
 */
export async function discoverCodexModels(
    options: DiscoverCodexModelsOptions,
): Promise<ModelDiscoveryOutcome> {
    const credential = await codexCredential(options.provider, options.env);
    if (credential === null) return { status: "no-credentials" };
    let failure: string | undefined;
    if (credential instanceof CodexSessionCredential) {
        try {
            const models = await fetchChatGptModels(credential, options);
            return { status: "discovered", source: "chatgpt", models };
        } catch (error: unknown) {
            failure = error instanceof Error ? error.message : String(error);
        }
    }
    for (const path of codexModelCachePaths(options.provider, options.env)) {
        const cache = await readCodexModelCache(path);
        if (cache?.models !== undefined) {
            return { status: "discovered", source: "codex-cache", models: cache.models };
        }
    }
    return {
        status: "failed",
        error:
            failure ??
            "Codex lists models only for a ChatGPT sign-in, and the Codex CLI has no model cache to read.",
    };
}

/** The version string the Codex CLI on this machine reports, or the best stand-in for it. */
export async function readCodexClientVersion(env: NodeJS.ProcessEnv): Promise<string> {
    try {
        const { stdout } = await execFileAsync("codex", ["--version"], {
            encoding: "utf8",
            env,
            killSignal: "SIGKILL",
            timeout: CODEX_VERSION_TIMEOUT_MS,
        });
        const match = /(\d+\.\d+\.\d+)/u.exec(stdout);
        if (match?.[1] !== undefined) return match[1];
    } catch {
        // The CLI is optional on this machine; its cache and the constant below stand in.
    }
    const cache = await readCodexModelCache(codexModelCachePath(env));
    return cache?.clientVersion ?? DEFAULT_CODEX_CLIENT_VERSION;
}

/** One Codex CLI cache file, when it holds a catalog. */
export async function readCodexModelCache(path: string): Promise<CodexModelCache | undefined> {
    let contents: string;
    try {
        contents = await readFile(path, "utf8");
    } catch {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(contents);
    } catch {
        return undefined;
    }
    const clientVersion = (parsed as { readonly client_version?: unknown } | null)?.client_version;
    return {
        clientVersion:
            typeof clientVersion === "string" && clientVersion.trim().length > 0
                ? clientVersion.trim()
                : undefined,
        models: codexDiscoveredModels(parsed),
    };
}

/**
 * Where one account's cached catalog may sit, most specific first.
 *
 * The Codex CLI keeps `models_cache.json` beside `auth.json`, so an account with its own auth
 * file looks beside that file first. Only an account without credential isolation goes on to the
 * machine's Codex home: an isolated account reads nothing it was not given.
 */
export function codexModelCachePaths(
    provider: CodexProviderRecord,
    env: NodeJS.ProcessEnv,
): readonly string[] {
    const paths: string[] = [];
    if (provider.authFile !== undefined) {
        paths.push(join(dirname(provider.authFile), CODEX_MODEL_CACHE_FILE));
    }
    if (provider.credentialIsolation !== true) {
        const ambient = codexModelCachePath(env);
        if (!paths.includes(ambient)) paths.push(ambient);
    }
    return paths;
}

/** The machine's own Codex CLI cache, under `CODEX_HOME` or the default `~/.codex`. */
export function codexModelCachePath(env: NodeJS.ProcessEnv): string {
    const codexHome = env.CODEX_HOME?.trim();
    return codexHome
        ? join(codexHome, CODEX_MODEL_CACHE_FILE)
        : join(homedir(), ".codex", CODEX_MODEL_CACHE_FILE);
}

/** The same credential the account's provider would use, isolation included. */
async function codexCredential(
    provider: CodexProviderRecord,
    env: NodeJS.ProcessEnv,
): Promise<CodexCredential> {
    if (provider.credentialIsolation === true) {
        if (provider.apiKey !== undefined) {
            return await CodexApiKeyCredential.tryLoad({ apiKey: provider.apiKey });
        }
        if (provider.authFile !== undefined) {
            return await CodexSessionCredential.tryLoad({ authFile: provider.authFile, env });
        }
        return null;
    }
    return await loadCodexCredential({
        env,
        ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
        ...(provider.authFile === undefined ? {} : { authFile: provider.authFile }),
    });
}

async function fetchChatGptModels(
    credential: CodexSessionCredential,
    options: DiscoverCodexModelsOptions,
): Promise<readonly DiscoveredAgentModel[]> {
    const version = await options.clientVersion();
    const url = `${CODEX_CHATGPT_ENDPOINT}${CODEX_MODELS_PATH}?client_version=${encodeURIComponent(version)}`;
    const headers = new Headers({
        accept: "application/json",
        authorization: `Bearer ${credential.credential.accessToken}`,
    });
    if (credential.credential.accountId !== undefined) {
        headers.set("chatgpt-account-id", credential.credential.accountId);
    }
    const response = await fetch(url, { method: "GET", headers, signal: options.signal });
    if (!response.ok) {
        throw new Error(`The Codex model listing returned HTTP ${String(response.status)}.`);
    }
    const models = codexDiscoveredModels(await response.json());
    if (models === undefined) throw new Error("The Codex model listing had an unexpected shape.");
    return models;
}
