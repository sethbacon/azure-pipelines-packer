import tasks = require('azure-pipelines-task-lib/task');
import tools = require('azure-pipelines-tool-lib/tool');
import path = require('path');
import os = require('os');
import fs = require('fs');
import crypto = require('crypto');

import { randomUUID as uuidV4 } from 'crypto';
import { fetchJson, fetchText, fetchTextAllow404 } from './http-client';
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

/** Strips the query string (which can carry a pre-signed signature/token) from a URL for safe logging. */
function redactUrl(url: string): string {
    try {
        const u = new URL(url);
        return u.origin + u.pathname + (u.search ? '?<redacted>' : '');
    } catch {
        return url.split('?')[0];
    }
}

/** Reads a boolean input that must fail closed even if task.json's default is not injected (e.g. headless/mock invocations). */
function getBoolInputWithDefault(name: string, defaultValue: boolean): boolean {
    const value = tasks.getInput(name, false);
    if (value === undefined || value === '') return defaultValue;
    return value === 'true';
}

const MIRROR_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Reads and validates registryMirrorName against a conservative charset, rejecting path separators/traversal shapes. */
function getValidatedMirrorName(): string {
    const mirrorName = tasks.getInput("registryMirrorName", true)! || "packer";
    if (!MIRROR_NAME_PATTERN.test(mirrorName)) {
        throw new Error(`registryMirrorName '${mirrorName}' contains characters other than letters, digits, '.', '_', '-'.`);
    }
    return mirrorName;
}

export async function downloadPacker(inputVersion: string): Promise<string> {
    const downloadSource = tasks.getInput("downloadSource") || "hashicorp";

    // Step 1: Resolve version string (may require an API call for 'latest')
    let resolvedVersion: string;
    switch (downloadSource) {
        case "registry": {
            const registryUrl = tasks.getInput("registryUrl", true)!;
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

    // Step 3: Download, extract, and cache if not found
    if (!cachedToolPath) {
        let zipPath: string;
        switch (downloadSource) {
            case "registry": {
                const registryUrl = tasks.getInput("registryUrl", true)!;
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

    tasks.setVariable('packerLocation', packerPath);
    return packerPath;
}

// --- Version resolution ---

async function resolveVersionFromHashiCorp(inputVersion: string): Promise<string> {
    if (inputVersion.toLowerCase() !== 'latest') {
        return inputVersion;
    }
    console.log(tasks.loc("GettingLatestPackerVersion"));
    try {
        const data = await fetchJson<{ current_version: string }>('https://checkpoint-api.hashicorp.com/v1/check/packer');
        if (!data.current_version) {
            throw new Error("HashiCorp checkpoint API returned invalid response: missing current_version");
        }
        return data.current_version;
    } catch (err) {
        tasks.debug(`HashiCorp checkpoint API request failed: ${err}`);
        tasks.warning(`${tasks.loc("PackerVersionNotFound")} (falling back to ${FALLBACK_PACKER_VERSION})`);
        return FALLBACK_PACKER_VERSION;
    }
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
        zipPath = await tools.downloadTool(downloadUrl, fileName);
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
    let zipPath: string;
    try {
        zipPath = await tools.downloadTool(data.download_url, fileName);
    } catch (exception) {
        // download_url is a pre-signed URL whose query string carries the signing
        // token; redact it (and scrub it from the tool-lib exception text) so the
        // live credential never reaches the build log via the failure message.
        const safeUrl = redactUrl(data.download_url);
        const safeMsg = String(exception instanceof Error ? exception.message : exception).split(data.download_url).join(safeUrl);
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
        zipPath = await tools.downloadTool(downloadUrl, fileName);
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
