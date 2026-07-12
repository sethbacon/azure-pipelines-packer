import tasks = require('azure-pipelines-task-lib/task');
import tools = require('azure-pipelines-tool-lib/tool');
import path = require('path');
import os = require('os');
import fs = require('fs');
import crypto = require('crypto');

import { randomUUID as uuidV4 } from 'crypto';
import { fetchJson, fetchText, fetchTextAllow404, DOWNLOAD_TIMEOUT_MS } from './http-client';
import { verifyGpgSignature } from './gpg-verifier';

const packerToolName = "packer";
const isWindows = os.type().match(/^Win/);

/** Fallback version used when the HashiCorp checkpoint API is unreachable. Update periodically. */
const FALLBACK_PACKER_VERSION = '1.12.0';

const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;

/** A downloaded artifact's hash did not match the expected checksum. Always fatal — never downgradable. */
class ChecksumMismatchError extends Error {
    constructor(message: string) { super(message); this.name = 'ChecksumMismatchError'; }
}
/** No usable checksum was published for the artifact (SUMS file absent, or the file not listed in it). Downgradable when requireChecksum is off. */
class ChecksumUnavailableError extends Error {
    constructor(message: string) { super(message); this.name = 'ChecksumUnavailableError'; }
}

/**
 * Strips the ENTIRE query string (which can carry a pre-signed signature/token —
 * Azure `sig`, AWS `X-Amz-Signature`/`X-Amz-Credential`/`X-Amz-Security-Token`,
 * GCS `X-Goog-Signature`/`X-Goog-Credential`) from a URL for safe logging. The whole
 * query is dropped rather than redacting known parameter names one at a time, so an
 * unforeseen token parameter can never leak through the error path.
 */
export function redactUrl(url: string): string {
    try {
        const u = new URL(url);
        return u.origin + u.pathname + (u.search ? '?<redacted>' : '');
    } catch {
        return url.split('?')[0];
    }
}

/**
 * True when a query-string parameter carries a live pre-signed credential/token: its
 * name is exactly `sig` (Azure SAS) or contains `signature`, `credential`, or `token`
 * — covering AWS (`X-Amz-Signature`/`X-Amz-Credential`/`X-Amz-Security-Token`) and GCS
 * (`X-Goog-Signature`/`X-Goog-Credential`) while leaving benign params such as
 * `X-Amz-SignedHeaders`, `X-Amz-Date`, and `X-Amz-Expires` visible.
 */
function isSensitiveQueryParam(name: string): boolean {
    const lower = name.toLowerCase();
    return lower === 'sig'
        || lower.includes('signature')
        || lower.includes('credential')
        || lower.includes('token');
}

/**
 * Extracts the values of every sensitive query-string token in `url`. Values are
 * returned in the raw form they appear in the URL (still percent-encoded) so they
 * match the exact substring tool-lib logs at INFO; the decoded form is added too when
 * it differs, so a consumer that logs the decoded value is masked as well. Used to
 * setSecret() the tokens before download and to scrub them from any failure message.
 */
function extractUrlTokenSecrets(url: string): string[] {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return [];
    const query = url.slice(qIndex + 1).split('#')[0];
    const secrets: string[] = [];
    for (const pair of query.split('&')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const name = pair.slice(0, eq);
        const rawValue = pair.slice(eq + 1);
        if (!rawValue || !isSensitiveQueryParam(name)) continue;
        secrets.push(rawValue);
        let decoded: string;
        try { decoded = decodeURIComponent(rawValue); } catch { decoded = rawValue; }
        if (decoded !== rawValue) secrets.push(decoded);
    }
    return secrets;
}

/**
 * Reads a boolean input that must fail closed even if task.json's default is not injected (e.g. headless/mock invocations).
 * Intentionally duplicated as a protected method in the PackerTask handler
 * (base-packer-command-handler.ts): the two tasks are bundled separately and
 * share no module, mirroring the annotated http-client.ts duplication.
 */
function getBoolInputWithDefault(name: string, defaultValue: boolean): boolean {
    const value = tasks.getInput(name, false);
    if (value === undefined || value === '') return defaultValue;
    return value === 'true';
}

/**
 * Races tools.downloadTool (azure-pipelines-tool-lib's typed-rest-client based
 * downloader) against a wall-clock timeout. downloadTool applies no timeout of its
 * own, so a stalled connection would otherwise hang the zip download — the largest
 * and slowest fetch of the install — until the pipeline's own job-timeout kills the
 * whole task with no specific diagnostic. Reuses the same DOWNLOAD_TIMEOUT_MS ceiling
 * the GPG signature fetch uses. `timeoutMs` is a parameter (default DOWNLOAD_TIMEOUT_MS)
 * purely so it can be exercised directly in a unit test without a 10-minute wait; every
 * real call site uses the default. See #105.
 *
 * Note: Promise.race cannot cancel the underlying request if it loses the race — the
 * download continues in the background — but the task has already failed and the
 * process exits shortly after, so this is an accepted, low-cost limitation rather
 * than a full re-architecture onto the hardened http-client (see #105 deferred notes).
 */
export async function downloadToolWithTimeout(url: string, fileName: string, timeoutMs: number = DOWNLOAD_TIMEOUT_MS): Promise<string> {
    let timer!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Download of ${redactUrl(url)} timed out after ${timeoutMs}ms.`)), timeoutMs);
    });
    try {
        return await Promise.race([tools.downloadTool(url, fileName), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

const MIRROR_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Reads and validates registryMirrorName against a conservative charset, rejecting path separators/traversal shapes. */
function getValidatedMirrorName(): string {
    // registryMirrorName is required=true with task.json defaultValue "packer", so
    // getInput() here always returns a non-empty string or throws first; the old
    // `|| "packer"` fallback was unreachable dead code.
    const mirrorName = tasks.getInput("registryMirrorName", true)!;
    if (!MIRROR_NAME_PATTERN.test(mirrorName)) {
        throw new Error(`registryMirrorName '${mirrorName}' contains characters other than letters, digits, '.', '_', '-'.`);
    }
    return mirrorName;
}

/**
 * Reads and validates registryUrl: must parse as a well-formed absolute URL and use
 * HTTPS (task.json's helpMarkDown already promises this; previously nothing enforced
 * it before the raw string was interpolated into request paths — see #139). Returns
 * the input with any trailing slash(es) stripped so `${registryUrl}/terraform/...`
 * concatenation never produces a double slash.
 */
function getValidatedRegistryUrl(): string {
    const registryUrl = tasks.getInput("registryUrl", true)!;
    let parsed: URL;
    try {
        parsed = new URL(registryUrl);
    } catch {
        throw new Error(`registryUrl '${registryUrl}' is not a valid URL.`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(tasks.loc("InsecureUrlRejected", registryUrl));
    }
    return registryUrl.replace(/\/+$/, '');
}

export async function downloadPacker(inputVersion: string): Promise<string> {
    const downloadSource = tasks.getInput("downloadSource") || "hashicorp";

    // Step 1: Resolve version string (may require an API call for 'latest')
    let resolvedVersion: string;
    switch (downloadSource) {
        case "registry": {
            const registryUrl = getValidatedRegistryUrl();
            const mirrorName = getValidatedMirrorName();
            resolvedVersion = await resolveVersionFromRegistry(inputVersion, registryUrl, mirrorName);
            break;
        }
        default: // "hashicorp" and "mirror" both use the HashiCorp checkpoint for 'latest'
            resolvedVersion = await resolveVersionFromHashiCorp(inputVersion);
    }

    const version = tools.cleanVersion(resolvedVersion);
    if (!version) {
        throw new Error(tasks.loc("InputVersionNotValidSemanticVersion", resolvedVersion));
    }

    // Step 2: Check tool cache — skip download entirely if already present
    let cachedToolPath = tools.findLocalTool(packerToolName, version);
    const wasCached = !!cachedToolPath;

    // Step 3: Download, extract, and cache if not found
    if (!cachedToolPath) {
        let zipPath: string;
        switch (downloadSource) {
            case "registry": {
                const registryUrl = getValidatedRegistryUrl();
                const mirrorName = getValidatedMirrorName();
                zipPath = await downloadZipFromRegistry(version, registryUrl, mirrorName);
                tasks.setVariable('packerDownloadedFrom', `registry:${registryUrl}`);
                break;
            }
            case "mirror": {
                const mirrorBaseUrl = tasks.getInput("mirrorBaseUrl", true)!;
                zipPath = await downloadZipFromMirror(version, mirrorBaseUrl);
                tasks.setVariable('packerDownloadedFrom', `mirror:${mirrorBaseUrl}`);
                break;
            }
            default: { // "hashicorp"
                zipPath = await downloadZipFromHashiCorp(version);
                tasks.setVariable('packerDownloadedFrom', 'hashicorp');
            }
        }

        const packerUnzippedPath = await tools.extractZip(zipPath);
        cachedToolPath = await tools.cacheDir(packerUnzippedPath, packerToolName, version);
    } else {
        tasks.setVariable('packerDownloadedFrom', 'cache');
    }

    const packerPath = findPackerExecutable(cachedToolPath);
    if (!packerPath) {
        throw new Error(tasks.loc("PackerNotFoundInFolder", cachedToolPath));
    }

    if (!isWindows) {
        fs.chmodSync(packerPath, "755");
    }

    // Cheap, offline re-verification of a cache hit (#136): the tool cache itself is
    // trusted for the lifetime of the agent (re-fetching SHA256SUMS/GPG on every hit
    // would defeat the point of caching), but a hash recorded when this binary was
    // first verified lets local tampering/corruption of the cache be caught without
    // any network access.
    if (wasCached) {
        await verifyCachedBinaryHash(packerPath);
    } else {
        recordCachedBinaryHash(packerPath);
    }

    tasks.setVariable('packerLocation', packerPath);
    return packerPath;
}

// --- Version resolution ---

async function resolveVersionFromHashiCorp(inputVersion: string): Promise<string> {
    if (inputVersion.toLowerCase() !== 'latest') {
        return inputVersion;
    }
    console.log(tasks.loc("GettingLatestPackerVersion"));
    // Only a genuine request failure (network/timeout/5xx, already retried by fetchJson)
    // falls back to the pinned version — that's an availability tradeoff worth keeping.
    // A malformed response (the API contract itself broke) is NOT caught here: it throws
    // fatally instead of silently downgrading, since silently trusting a fallback version
    // in that case would mask a real API-shape regression rather than a transient blip.
    let data: { current_version: string };
    try {
        data = await fetchJson<{ current_version: string }>('https://checkpoint-api.hashicorp.com/v1/check/packer');
    } catch (err) {
        tasks.debug(`HashiCorp checkpoint API request failed: ${err}`);
        tasks.warning(`${tasks.loc("PackerVersionNotFound")} (falling back to ${FALLBACK_PACKER_VERSION})`);
        return FALLBACK_PACKER_VERSION;
    }
    if (!data.current_version) {
        throw new Error("HashiCorp checkpoint API returned invalid response: missing current_version");
    }
    return data.current_version;
}

async function resolveVersionFromRegistry(inputVersion: string, registryUrl: string, mirrorName: string): Promise<string> {
    if (inputVersion.toLowerCase() !== 'latest') {
        return inputVersion;
    }
    console.log(tasks.loc("ResolvingLatestFromRegistry", registryUrl));
    const latestUrl = `${registryUrl}/terraform/binaries/${mirrorName}/versions/latest`;
    const data = await fetchJson<{ version: string }>(latestUrl);
    if (!data.version) {
        throw new Error(`Registry API returned invalid response: missing version field from ${latestUrl}`);
    }
    console.log(tasks.loc("ResolvedVersionFromRegistry", data.version));
    return data.version;
}

// --- Download strategies ---

async function downloadZipFromHashiCorp(version: string): Promise<string> {
    const downloadUrl = getHashiCorpDownloadUrl(version);
    const fileName = `${packerToolName}-${version}-${uuidV4()}.zip`;
    let zipPath: string;
    try {
        zipPath = await downloadToolWithTimeout(downloadUrl, fileName);
    } catch (exception) {
        throw new Error(tasks.loc("PackerDownloadFailed", downloadUrl, exception));
    }

    const osPlatform = getPlatformString();
    const arch = getArchString();
    const zipFileName = `packer_${version}_${osPlatform}_${arch}.zip`;
    const sha256SumsUrl = `https://releases.hashicorp.com/packer/${version}/packer_${version}_SHA256SUMS`;
    const sha256SumsSigUrl = `${sha256SumsUrl}.sig`;

    const sha256SumsContent = await fetchText(sha256SumsUrl);
    const requireGpg = getBoolInputWithDefault("requireGpgSignature", true);
    await verifyGpgSignature(sha256SumsContent, sha256SumsSigUrl, requireGpg);

    const expectedHash = parseSha256(sha256SumsContent, zipFileName);
    await verifySha256(zipPath, expectedHash);

    return zipPath;
}

async function downloadZipFromRegistry(version: string, registryUrl: string, mirrorName: string): Promise<string> {
    const osPlatform = getPlatformString();
    const arch = getArchString();
    const infoUrl = `${registryUrl}/terraform/binaries/${mirrorName}/versions/${version}/${osPlatform}/${arch}`;

    const data = await fetchJson<{ download_url: string; sha256: string }>(infoUrl);
    if (!data.download_url) {
        throw new Error(`Registry API returned invalid response: missing download_url from ${infoUrl}`);
    }
    // data.download_url = pre-signed storage URL (time-limited)
    // data.sha256       = hex SHA256 of the zip (may be empty if registry verified server-side)
    // The download URL is registry-controlled and fetched outside fetchJson's HTTPS
    // guard, so pin it to HTTPS before downloading — as the mirror path already does.
    if (!data.download_url.startsWith('https://')) {
        throw new Error(tasks.loc("InsecureUrlRejected", data.download_url));
    }
    if (data.sha256 && !SHA256_HEX_PATTERN.test(data.sha256)) {
        throw new Error(`Registry API returned a malformed sha256 for ${infoUrl}: expected 64 hex characters.`);
    }

    const fileName = `${packerToolName}-${version}-${uuidV4()}.zip`;
    // The pre-signed download_url carries a live, read-scoped storage credential in
    // its query string. tools.downloadTool logs the URL at INFO and only auto-redacts
    // Azure `sig=`, so AWS X-Amz-Signature/X-Amz-Credential/X-Amz-Security-Token and
    // GCS X-Goog-Signature/X-Goog-Credential would otherwise print unredacted on every
    // normal registry run. Register each token component as a secret FIRST so the agent
    // masks it in tool-lib's log line (and in any failure message). See #98.
    const urlTokenSecrets = extractUrlTokenSecrets(data.download_url);
    for (const secret of urlTokenSecrets) {
        tasks.setSecret(secret);
    }
    let zipPath: string;
    try {
        zipPath = await downloadToolWithTimeout(data.download_url, fileName);
    } catch (exception) {
        // download_url is a pre-signed URL whose query string carries the signing
        // token; drop the whole query (redactUrl) and scrub the raw URL out of the
        // tool-lib exception text so the live credential never reaches the build log
        // via the failure message.
        const safeUrl = redactUrl(data.download_url);
        let safeMsg = String(exception instanceof Error ? exception.message : exception).split(data.download_url).join(safeUrl);
        // Belt-and-suspenders: tool-lib may embed a URL it partially transformed
        // (its own `sig=` redaction) that the exact-URL replace above misses, so also
        // scrub each known token value out of the message.
        for (const secret of urlTokenSecrets) {
            safeMsg = safeMsg.split(secret).join('<redacted>');
        }
        throw new Error(tasks.loc("PackerDownloadFailed", safeUrl, safeMsg));
    }

    const requireChecksum = getBoolInputWithDefault("requireChecksum", true);
    if (data.sha256) {
        await verifySha256(zipPath, data.sha256);
    } else if (requireChecksum) {
        throw new Error(`Checksum verification is required but the registry did not provide a sha256 for ${infoUrl}. Set 'requireChecksum' to false to trust the registry's server-side verification only.`);
    } else {
        tasks.warning(`The registry returned no sha256 for ${infoUrl}; the binary is installed WITHOUT any local integrity verification (no checksum and the registry source performs no GPG check) — you are trusting the registry's server-side verification and TLS alone. Set 'requireChecksum' to true to require a local check.`);
    }
    return zipPath;
}

async function downloadZipFromMirror(version: string, mirrorBaseUrl: string): Promise<string> {
    if (!mirrorBaseUrl.startsWith('https://')) {
        throw new Error(tasks.loc("InsecureUrlRejected", mirrorBaseUrl));
    }
    const osPlatform = getPlatformString();
    const arch = getArchString();
    // Mirror must serve files at the same path structure as releases.hashicorp.com/packer
    const downloadUrl = `${mirrorBaseUrl}/${version}/packer_${version}_${osPlatform}_${arch}.zip`;

    const fileName = `${packerToolName}-${version}-${uuidV4()}.zip`;
    let zipPath: string;
    try {
        zipPath = await downloadToolWithTimeout(downloadUrl, fileName);
    } catch (exception) {
        throw new Error(tasks.loc("PackerDownloadFailed", downloadUrl, exception));
    }

    const zipFileName = `packer_${version}_${osPlatform}_${arch}.zip`;
    const sha256SumsUrl = `${mirrorBaseUrl}/${version}/packer_${version}_SHA256SUMS`;
    const requireChecksum = getBoolInputWithDefault("requireChecksum", true);
    const requireGpg = getBoolInputWithDefault("requireGpgSignature", true);

    // A missing SHA256SUMS (HTTP 404) means the mirror published no checksum; any
    // other fetch error (5xx / network) is transient and left to throw (fatal).
    const sha256SumsContent = await fetchTextAllow404(sha256SumsUrl);
    if (sha256SumsContent === null) {
        if (requireChecksum) {
            throw new Error(`Checksum verification is required but the mirror did not publish a SHA256SUMS file (${sha256SumsUrl}). Set 'requireChecksum' to false to install without it.`);
        }
        tasks.warning(`The mirror published no SHA256SUMS file (${sha256SumsUrl}); the binary is installed WITHOUT any local integrity verification. Set 'requireChecksum' to true to require it.`);
        return zipPath;
    }

    // SUMS is present: honor requireGpgSignature on the mirror path too (previously
    // GPG was only enforced on the hashicorp source — the toggle was inert here).
    await verifyGpgSignature(sha256SumsContent, `${sha256SumsUrl}.sig`, requireGpg);

    try {
        const expectedHash = parseSha256(sha256SumsContent, zipFileName);
        await verifySha256(zipPath, expectedHash);
    } catch (error) {
        // A genuine hash MISMATCH is always fatal, regardless of requireChecksum.
        if (error instanceof ChecksumMismatchError) throw error;
        // The SUMS file did not list our artifact — treat as "unavailable".
        if (error instanceof ChecksumUnavailableError) {
            if (requireChecksum) {
                throw new Error(`Checksum verification is required but ${zipFileName} is not listed in the mirror's SHA256SUMS (${sha256SumsUrl}).`);
            }
            tasks.warning(`${zipFileName} is not listed in the mirror's SHA256SUMS (${sha256SumsUrl}); skipping checksum verification. Set 'requireChecksum' to true to require it.`);
        } else {
            throw error;
        }
    }

    return zipPath;
}

// --- Helpers ---

function parseSha256(sha256SumsContent: string, zipFileName: string): string {
    const lines = sha256SumsContent.split('\n');
    for (const line of lines) {
        // Format: "<hex-hash>  <filename>" (two spaces between hash and filename)
        const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
        if (match && match[2].trim() === zipFileName) {
            tasks.debug(`Found SHA256 for ${zipFileName}: ${match[1]}`);
            return match[1];
        }
    }
    throw new ChecksumUnavailableError(`SHA256 checksum not found for ${zipFileName}`);
}

async function verifySha256(filePath: string, expectedHash: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new ChecksumMismatchError(tasks.loc("Sha256VerificationFailed", expectedHash, actualHash));
    }
    tasks.debug(`SHA256 verification passed: ${actualHash}`);
}

function getCacheHashSidecarPath(packerPath: string): string {
    return `${packerPath}.sha256`;
}

/**
 * Records the freshly-downloaded-and-verified binary's hash so a future cache hit can
 * cheaply (no network) detect local tampering/corruption of the agent's tool cache
 * (#136). Best-effort: a write failure only warns -- it must never fail an otherwise
 * successful install.
 */
function recordCachedBinaryHash(packerPath: string): void {
    try {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(packerPath)).digest('hex');
        fs.writeFileSync(getCacheHashSidecarPath(packerPath), hash, { mode: 0o600 });
    } catch (error) {
        tasks.debug(`Could not record a cache-integrity hash for ${packerPath}: ${error instanceof Error ? error.message : error}`);
    }
}

/**
 * On a cache hit, cheaply (no network) re-verifies the cached binary against the hash
 * recorded when it was first downloaded and verified (#136). A cache entry from before
 * this check existed has no sidecar file yet -- that is treated as an unverifiable
 * legacy entry, not tampering (a hash is recorded now so it is covered going forward).
 * Being unable to even perform the check (sidecar read failure, etc.) only warns and
 * continues -- this is a best-effort defense-in-depth layer, not a hard gate, and must
 * never turn an unrelated filesystem quirk into a failed install. A genuine hash
 * MISMATCH against an existing, readable sidecar is the one case that always fails.
 */
async function verifyCachedBinaryHash(packerPath: string): Promise<void> {
    const sidecarPath = getCacheHashSidecarPath(packerPath);
    let sidecarExists: boolean;
    try {
        sidecarExists = fs.existsSync(sidecarPath);
    } catch (error) {
        tasks.debug(`Could not check for a cache-integrity hash at ${sidecarPath}: ${error instanceof Error ? error.message : error}`);
        return;
    }
    if (!sidecarExists) {
        tasks.debug(`No cache-integrity hash recorded for ${packerPath} yet (cached before this check existed); recording one now.`);
        recordCachedBinaryHash(packerPath);
        return;
    }
    let expectedHash: string;
    try {
        expectedHash = fs.readFileSync(sidecarPath, 'utf8').trim();
    } catch (error) {
        tasks.debug(`Could not read the cache-integrity hash at ${sidecarPath}: ${error instanceof Error ? error.message : error}`);
        return;
    }
    // A genuine mismatch (ChecksumMismatchError) always propagates -- that is real
    // local tampering/corruption, distinct from merely being unable to check.
    await verifySha256(packerPath, expectedHash);
}

function getPlatformString(): string {
    switch (os.type()) {
        case "Darwin": return "darwin";
        case "Linux": return "linux";
        case "Windows_NT": return "windows";
        default: throw new Error(tasks.loc("OperatingSystemNotSupported", os.type()));
    }
}

function getArchString(): string {
    switch (os.arch()) {
        case "x64": return "amd64";
        case "ia32": return "386";
        case "arm64": return "arm64";
        case "arm": return "arm";
        default: throw new Error(tasks.loc("ArchitectureNotSupported", os.arch()));
    }
}

function getHashiCorpDownloadUrl(version: string): string {
    return `https://releases.hashicorp.com/packer/${version}/packer_${version}_${getPlatformString()}_${getArchString()}.zip`;
}

function findPackerExecutable(rootFolder: string): string {
    const execPath = path.join(rootFolder, packerToolName + getExecutableExtension());
    const allPaths = tasks.find(rootFolder);
    const matchingResultFiles = tasks.match(allPaths, execPath, rootFolder);
    return matchingResultFiles[0];
}

function getExecutableExtension(): string {
    if (isWindows) {
        return ".exe";
    }
    return "";
}
