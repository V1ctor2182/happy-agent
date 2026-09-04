import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MACOS_KEYCHAIN_TIMEOUT_MS = 500;

interface ClaudeCodeCredentials {
    readonly claudeAiOauth?: { readonly accessToken?: unknown } | null;
}

export interface ReadClaudeCodeOAuthTokenOptions {
    readonly env: NodeJS.ProcessEnv;
}

/**
 * The access token behind this machine's Claude Code sign-in.
 *
 * This mirrors how the provider package reads the same sign-in for its own requests: the macOS
 * keychain entry Claude Code writes, then `.credentials.json` in the Claude config directory. The
 * published provider package does not export that reader, and the account's provider only proves
 * a sign-in exists, so listing models needs its own copy of the lookup.
 */
export async function readClaudeCodeOAuthToken(
    options: ReadClaudeCodeOAuthTokenOptions,
): Promise<string | undefined> {
    const env = options.env;
    const configDirectory = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
    if (process.platform === "darwin") {
        const keychainToken = await readTokenFromMacOsKeychain(configDirectory, env);
        if (keychainToken !== undefined) return keychainToken;
    }
    try {
        return parseClaudeOAuthAccessToken(
            await readFile(join(configDirectory, ".credentials.json"), "utf8"),
        );
    } catch {
        return undefined;
    }
}

export function parseClaudeOAuthAccessToken(value: string): string | undefined {
    try {
        const credentials = JSON.parse(value) as ClaudeCodeCredentials | null;
        const token = credentials?.claudeAiOauth?.accessToken;
        return typeof token === "string" && token.trim().length > 0 ? token : undefined;
    } catch {
        return undefined;
    }
}

async function readTokenFromMacOsKeychain(
    configDirectory: string,
    env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
    const defaultDirectory = env.CLAUDE_CONFIG_DIR === undefined;
    const directorySuffix = defaultDirectory
        ? ""
        : `-${createHash("sha256").update(configDirectory).digest("hex").slice(0, 8)}`;
    const oauthSuffix = env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? "-custom-oauth" : "";
    const service = `Claude Code${oauthSuffix}-credentials${directorySuffix}`;
    const account = env.USER ?? userInfo().username;
    try {
        const { stdout } = await execFileAsync(
            "security",
            ["find-generic-password", "-a", account, "-w", "-s", service],
            { encoding: "utf8", killSignal: "SIGKILL", timeout: MACOS_KEYCHAIN_TIMEOUT_MS },
        );
        return parseClaudeOAuthAccessToken(stdout);
    } catch {
        return undefined;
    }
}
