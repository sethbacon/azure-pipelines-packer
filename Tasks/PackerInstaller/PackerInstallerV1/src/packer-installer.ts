import tasks = require('azure-pipelines-task-lib/task');
import tools = require('azure-pipelines-tool-lib/tool');
import path = require('path');
import os = require('os');
import fs = require('fs');
import crypto = require('crypto');

import { randomUUID as uuidV4 } from 'crypto';
import { fetchJson, fetchText } from './http-client';
import { verifyGpgSignature } from './gpg-verifier';

const packerToolName = "packer";
const isWindows = os.type().match(/^Win/);

/** Fallback version used when the HashiCorp checkpoint API is unreachable. Update periodically. */
const FALLBACK_PACKER_VERSION = '1.12.0';

const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;

/** Reads a boolean input that must fail closed even if task.json's default is not injected (e.g. headless/mock invocations). */
function getBoolInputWithDefault(name: string, defaultValue: boolean): boolean {
    const value = tasks.getInput(name, false);
    if (value === undefined || value === '') return defaultValue;
    return value === 'true';
}

export async function downloadPacker(inputVersion: string): Promise<string> {
    const downloadSource = tasks.getInput("downloadSource") || "hashicorp";

    // Step 1: Resolve version string (may require an API call for 'latest')
    let resolvedVersion: string;
    switch (downloadSource) {
        case "registry": {
            const registryUrl = tasks.getInput("registryUrl", true)!;
            const mirrorName = tasks.getInput("registryMirrorName", true)! || "packer";
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
                const mirrorName = tasks.getInput("registryMirrorName", true)! || "packer";
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
    } catch {
        tasks.warning(tasks.loc("PackerVersionNotFound"));
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
        throw new Error(tasks.loc("PackerDownloadFailed", data.download_url, exception));
    }

    const requireChecksum = getBoolInputWithDefault("requireChecksum", true);
    if (data.sha256) {
        await verifySha256(zipPath, data.sha256);
    } else if (requireChecksum) {
        throw new Error(`Checksum verification is required but the registry did not provide a sha256 for ${infoUrl}. Set 'requireChecksum' to false to trust the registry's server-side verification only.`);
    } else {
        tasks.warning(`SHA256 not provided by registry for ${infoUrl}; skipping local verification (trusting the registry's server-side verification only). Set 'requireChecksum' to enforce a local check.`);
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

    // Attempt SHA256 verification from mirror — fail if SHA256SUMS is available but hash doesn't match
    const zipFileName = `packer_${version}_${osPlatform}_${arch}.zip`;
    const sha256SumsUrl = `${mirrorBaseUrl}/${version}/packer_${version}_SHA256SUMS`;
    const requireChecksum = getBoolInputWithDefault("requireChecksum", true);
    try {
        const expectedHash = await fetchExpectedSha256(sha256SumsUrl, zipFileName);
        await verifySha256(zipPath, expectedHash);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const checksumUnavailable = errorMessage.includes('SHA256 checksum not found') || errorMessage.includes('Failed to fetch');
        // A genuine hash mismatch is always fatal. An unavailable SHA256SUMS file is
        // fatal only when the user requires checksum verification; otherwise warn.
        if (checksumUnavailable && !requireChecksum) {
            tasks.warning(`SHA256 verification skipped for mirror download: ${errorMessage}`);
        } else if (checksumUnavailable) {
            throw new Error(`Checksum verification is required but the mirror did not provide a usable SHA256SUMS file (${sha256SumsUrl}): ${errorMessage}`);
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
    throw new Error(`SHA256 checksum not found for ${zipFileName}`);
}

async function fetchExpectedSha256(sha256SumsUrl: string, zipFileName: string): Promise<string> {
    tasks.debug(`Fetching SHA256SUMS from ${sha256SumsUrl}`);
    const body = await fetchText(sha256SumsUrl);
    return parseSha256(body, zipFileName);
}

async function verifySha256(filePath: string, expectedHash: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new Error(tasks.loc("Sha256VerificationFailed", expectedHash, actualHash));
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
