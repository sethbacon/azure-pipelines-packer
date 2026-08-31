import tasks = require('azure-pipelines-task-lib/task');
import tools = require('azure-pipelines-tool-lib/tool');
import path = require('path');
import os = require('os');
import fs = require('fs');
import crypto = require('crypto');

import { randomUUID as uuidV4 } from 'crypto';
import { fetchJson, fetchText, fetchTextAllow404, downloadToFile, DOWNLOAD_TIMEOUT_MS } from './http-client';
import { verifyGpgSignature } from './gpg-verifier';
import { parseAllowedHosts, assertEgressHostAllowed, EgressHostMessages } from '@4cloudguru/pipeline-task-core';
import { validateUrlPathSegment } from '@4cloudguru/pipeline-task-core';
import {
    VerificationFailure,
    isVerificationFailure,
    discardArtifactOnFailure,
    extractUrlTokenSecrets,
    extractUrlUserInfoSecrets,
    redactUrl,
    redactUrlUserInfo,
    scrubSecretsFromMessage,
} from '@4cloudguru/pipeline-task-core';
import { getBoolInputDefaultTrue } from '@4cloudguru/pipeline-task-ado';

// The package takes the debug sink as a parameter rather than importing the ADO
// task lib itself; passing it keeps the discard visible in the build log.
const discardLog = { debug: (message: string) => tasks.debug(message) };

// Re-exported for backward compatibility: Tests/L0.ts imports redactUrl from this
// module. The implementation now lives in @4cloudguru/pipeline-task-core.
export { redactUrl } from '@4cloudguru/pipeline-task-core';

const packerToolName = "packer";
const isWindows = os.type().match(/^Win/);

const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;

/**
 * A downloaded zip plus whether it ACTUALLY passed an integrity check. The mirror
 * and registry sources can legitimately return an unverified artifact when the
 * operator opted out (requireChecksum=false), and the caller must not record a
 * cache-integrity hash for one of those.
 */
type DownloadedZip = { zipPath: string; verified: boolean };

/**
 * A downloaded artifact's hash did not match the expected checksum. Always fatal —
 * never downgradable. A VerificationFailure, so the cache-hit re-verification path
 * fails closed on it rather than degrading to the cached binary.
 */
class ChecksumMismatchError extends VerificationFailure {
    constructor(message: string) { super(message); this.name = 'ChecksumMismatchError'; }
}
/**
 * No usable checksum was published for the artifact (SUMS file absent, or the file
 * not listed in it). A VerificationFailure: downgradable at the point a caller
 * explicitly catches THIS type and branches on requireChecksum (the mirror/registry
 * fresh-install paths do exactly that) -- but otherwise fail-closed like any other
 * VerificationFailure. That matters for the cache-hit re-verification path
 * (reverifyUnmarkedCacheEntry), which only ever runs with requireChecksum=true and
 * has no such catch: before this extended VerificationFailure, a reachable source
 * that withheld its checksum fell into the same lenient branch as a genuinely
 * UNREACHABLE source, silently keeping the stale cached binary instead of failing
 * closed (#334).
 */
class ChecksumUnavailableError extends VerificationFailure {
    constructor(message: string) { super(message); this.name = 'ChecksumUnavailableError'; }
}

/**
 * setSecret() any basic-auth userinfo embedded in an operator-supplied
 * registry/mirror URL, so the agent masks it everywhere the URL — or any URL
 * derived from it (infoUrl, latestUrl, sha256SumsUrl, downloadUrl) — might be
 * echoed: pipeline variables, console output, error and warning messages.
 * Idempotent; call at the earliest use of each operator URL, BEFORE the first
 * emission. Pair with redactUrlUserInfo() to structurally strip the credential
 * from any value that is stored or displayed (setSecret only masks logs, it does
 * not sanitize a persisted pipeline variable's value). Mirrors
 * azure-pipelines-terraform's registry-version-resolver.ts helper of the same
 * name.
 */
function maskOperatorUrlCredentials(url: string): void {
    for (const secret of extractUrlUserInfoSecrets(url)) {
        tasks.setSecret(secret);
    }
}

/**
 * Reads a boolean input that must fail closed even if task.json's default is not
 * injected (e.g. headless/mock invocations).
 *
 * Now the shared `getBoolInputDefaultTrue` from @4cloudguru/pipeline-task-ado
 * rather than a local copy. The former local copy compared against the lowercase
 * literal `'true'`, so the capitalized form YAML produces for an unquoted
 * `requireChecksum: true` read as FALSE and silently disabled verification (#331).
 * The two tasks in this extension no longer "share no module" — both depend on
 * pipeline-task-ado — so the duplication that let this drift is gone with it.
 */

/**
 * Reads registryMirrorName and validates it as a single URL path segment before
 * it is interpolated into the registry API path. Delegates to the shared
 * validateUrlPathSegment() so the traversal rejection can never drift between
 * this task and the sibling terraform installers (#200) — the previous local
 * charset pattern allowed the literal `..` despite its comment claiming
 * otherwise.
 */
function getValidatedMirrorName(): string {
    // registryMirrorName is required=true with task.json defaultValue "packer", so
    // getInput() here always returns a non-empty string or throws first; the old
    // `|| "packer"` fallback was unreachable dead code.
    return validateUrlPathSegment('registryMirrorName', tasks.getInput("registryMirrorName", true)!);
}

/**
 * Localized rejection text for the mirror download source's egress authorization.
 * Both keys are declared in task.json's `messages` map (which is what task-lib
 * actually iterates when loading resources) as well as in the resjson — a key
 * present only in the resjson is never loaded and renders as its raw key name
 * (#201), which would have degraded exactly these two guards' diagnostics.
 */
const MIRROR_EGRESS_MESSAGES: EgressHostMessages = {
    notAllowed: (hostname, allowedHosts) => tasks.loc('MirrorDownloadHostNotAllowed', hostname, allowedHosts),
    isPrivate: (hostname) => tasks.loc('MirrorDownloadHostIsPrivate', hostname),
};

/** Localized rejection text for the private-registry download source's egress authorization. */
const REGISTRY_EGRESS_MESSAGES: EgressHostMessages = {
    notAllowed: (hostname, allowedHosts) => tasks.loc('RegistryDownloadHostNotAllowed', hostname, allowedHosts),
    isPrivate: (hostname) => tasks.loc('RegistryDownloadHostIsPrivate', hostname),
};

/**
 * Localized rejection text for the default HashiCorp download source's egress
 * authorization. There is no operator-configurable allowlist input for this
 * source -- the initial host is always releases.hashicorp.com -- so
 * notAllowed is unreachable in practice (assertEgressHostAllowed only calls it
 * when the allowlist is non-empty); isPrivate is the one that matters, guarding
 * against a redirect hop resolving to a private/link-local/metadata address
 * (#334).
 */
const HASHICORP_EGRESS_MESSAGES: EgressHostMessages = {
    notAllowed: (hostname, allowedHosts) => tasks.loc('HashiCorpDownloadHostNotAllowed', hostname, allowedHosts),
    isPrivate: (hostname) => tasks.loc('HashiCorpDownloadHostIsPrivate', hostname),
};

/**
 * Reads and validates registryUrl: must parse as a well-formed absolute URL, use
 * HTTPS (task.json's helpMarkDown already promises this; previously nothing enforced
 * it before the raw string was interpolated into request paths — see #139), and name
 * a host this task is authorized to reach (#330). Returns the input with any trailing
 * slash(es) stripped so `${registryUrl}/terraform/...` concatenation never produces a
 * double slash.
 */
async function getValidatedRegistryUrl(): Promise<string> {
    const registryUrl = tasks.getInput("registryUrl", true)!;
    // registryUrl may embed basic-auth userinfo (https://user:password@host/...,
    // a real pattern for internal artifact proxies). Mask it BEFORE the first
    // emission below, and strip it structurally from every message.
    maskOperatorUrlCredentials(registryUrl);
    let parsed: URL;
    try {
        parsed = new URL(registryUrl);
    } catch {
        throw new Error(`registryUrl '${redactUrlUserInfo(registryUrl)}' is not a valid URL.`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(tasks.loc("InsecureUrlRejected", redactUrlUserInfo(registryUrl)));
    }
    // #330: authorize registryUrl's OWN host, matching what the mirror source does
    // to mirrorBaseUrl. Previously this guard was applied only to the download_url
    // the registry hands back, which cannot cover the two requests made BEFORE any
    // download_url exists (version resolution and the info fetch). Those requests
    // went to whatever host the operator named — including the cloud metadata
    // service — and because registryUrl explicitly supports basic-auth userinfo,
    // the registry credential was sent along with them.
    //
    // Authorizing here rather than at the call sites means every present and future
    // consumer of this URL inherits the check; there is no way to obtain the
    // validated URL without having passed it.
    //
    // Default (registryAllowedHosts empty) is the baseline private/reserved refusal,
    // so an ordinary public registry is unaffected; an operator whose registry
    // legitimately lives on a private address pins it explicitly, exactly as the
    // mirror source requires.
    const registryAllowedHosts = parseAllowedHosts(tasks.getInput("registryAllowedHosts", false));
    await assertEgressHostAllowed(parsed.hostname, registryAllowedHosts, REGISTRY_EGRESS_MESSAGES);
    return registryUrl.replace(/\/+$/, '');
}

export async function downloadPacker(inputVersion: string): Promise<string> {
    const downloadSource = tasks.getInput("downloadSource") || "hashicorp";

    // Step 1: Resolve version string (may require an API call for 'latest')
    let resolvedVersion: string;
    switch (downloadSource) {
        case "registry": {
            const registryUrl = await getValidatedRegistryUrl();
            const mirrorName = getValidatedMirrorName();
            resolvedVersion = await resolveVersionFromRegistry(inputVersion, registryUrl, mirrorName, hostname =>
                assertEgressHostAllowed(hostname, parseAllowedHosts(tasks.getInput("registryAllowedHosts", false)), REGISTRY_EGRESS_MESSAGES));
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
    // `verified` records whether this install's artifact ACTUALLY passed an
    // integrity check: the registry and mirror sources can both legitimately
    // return an unverified zip when the operator opted out (requireChecksum
    // false). Recording a cache-integrity hash for such a binary would stamp
    // "verified" on something nothing ever verified, and every later cache hit
    // would then pass its re-verification (#136).
    let verified = false;
    if (!cachedToolPath) {
        let zipPath: string;
        switch (downloadSource) {
            case "registry": {
                const registryUrl = await getValidatedRegistryUrl();
                const mirrorName = getValidatedMirrorName();
                ({ zipPath, verified } = await downloadZipFromRegistry(version, registryUrl, mirrorName));
                // Strip any embedded basic-auth userinfo before persisting the source
                // into a downstream-readable pipeline variable (setSecret masks logs,
                // not a stored variable's value).
                tasks.setVariable('packerDownloadedFrom', `registry:${redactUrlUserInfo(registryUrl)}`);
                break;
            }
            case "mirror": {
                const mirrorBaseUrl = tasks.getInput("mirrorBaseUrl", true)!;
                ({ zipPath, verified } = await downloadZipFromMirror(version, mirrorBaseUrl));
                tasks.setVariable('packerDownloadedFrom', `mirror:${redactUrlUserInfo(mirrorBaseUrl)}`);
                break;
            }
            default: { // "hashicorp"
                ({ zipPath, verified } = await downloadZipFromHashiCorp(version));
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

    // Re-verification of a cache hit (#136). A version cached by a possibly-earlier
    // job on this (potentially persistent, self-hosted) agent is otherwise reused
    // without re-running the verification THIS job demands. Two layers:
    //
    //   1. Offline: compare the cached binary against the hash recorded when it was
    //      first downloaded AND verified. No network, so air-gapped reuse still works.
    //      Trust-boundary note: the sidecar lives beside the binary it protects (see
    //      verifyCachedBinaryHash), so this layer is corruption/cross-job-policy-mixing
    //      detection, not a defense against an attacker who can already write to the
    //      agent's tool cache.
    //   2. When no usable hash was recorded (cached before this check existed, cached
    //      by a run with verification disabled, or the record is unreadable/malformed),
    //      escalate: re-download through the same source and require a byte match.
    //
    // forceOnlineReverification (default false) escalates to layer 2 even when layer 1
    // passes, for an operator who does not accept the co-located sidecar's trust
    // boundary on a given agent.
    //
    // A hash is recorded only for an artifact this run actually verified.
    if (wasCached) {
        const forceReverify = tasks.getBoolInput("forceOnlineReverification", false);
        const recordVerified = await verifyCachedBinaryHash(packerPath);
        if (!recordVerified || forceReverify) {
            await reverifyUnmarkedCacheEntry(
                `packer ${version}`,
                packerPath,
                () => downloadVerifiedZipForReverify(downloadSource, version),
                recordVerified ? 'forced' : 'unmarked',
            );
        }
    } else if (verified) {
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
    // Fail closed (#78): a caller who asked for 'latest' — often precisely for
    // security currency — must not be silently handed a hardcoded, since-superseded
    // version because the checkpoint API was unreachable. A selective outage of only
    // the version endpoint would otherwise force a silent downgrade that a green
    // build's warning is easy to miss. Matches the sibling terraform installers,
    // which all throw here rather than pinning a stale FALLBACK_* constant.
    let data: { current_version: string };
    try {
        data = await fetchJson<{ current_version: string }>('https://checkpoint-api.hashicorp.com/v1/check/packer');
    } catch (err) {
        throw new Error(`${tasks.loc("PackerVersionNotFound")} (${err instanceof Error ? err.message : err})`);
    }
    if (typeof data.current_version !== 'string' || !data.current_version) {
        throw new Error("HashiCorp checkpoint API returned invalid response: missing current_version");
    }
    return data.current_version;
}

async function resolveVersionFromRegistry(inputVersion: string, registryUrl: string, mirrorName: string, authorizeHost: (hostname: string) => Promise<void>): Promise<string> {
    if (inputVersion.toLowerCase() !== 'latest') {
        return inputVersion;
    }
    // registryUrl may embed basic-auth userinfo; mask it before it can reach a log
    // via latestUrl in the console line or error below.
    maskOperatorUrlCredentials(registryUrl);
    // getValidatedRegistryUrl() already authorized this host, but that is a property
    // of the caller's ordering rather than of this request. Re-asserting here keeps
    // the guarantee local and machine-checkable (#330).
    await authorizeHost(new URL(registryUrl).hostname);
    console.log(tasks.loc("ResolvingLatestFromRegistry", redactUrlUserInfo(registryUrl)));
    const latestUrl = `${registryUrl}/terraform/binaries/${mirrorName}/versions/latest`;
    const data = await fetchJson<{ version: string }>(latestUrl);
    if (typeof data.version !== 'string' || !data.version) {
        throw new Error(`Registry API returned invalid response: missing version field from ${redactUrlUserInfo(latestUrl)}`);
    }
    console.log(tasks.loc("ResolvedVersionFromRegistry", data.version));
    return data.version;
}

// --- Download strategies ---

async function downloadZipFromHashiCorp(version: string): Promise<DownloadedZip> {
    const downloadUrl = getHashiCorpDownloadUrl(version);
    const fileName = `${packerToolName}-${version}-${uuidV4()}.zip`;
    // Egress authorization for the download destination -- the SAME decision
    // (assertEgressHostAllowed) applied to the initial URL and, via
    // downloadToFile, to every redirect hop. Previously this used
    // downloadToolWithTimeout -> tools.downloadTool(), which follows redirects
    // with no way to re-validate or disable that -- so a compromised CDN edge
    // or a MITM'd redirect chain could steer the download to an arbitrary host
    // (including a private/link-local/metadata address) and this task would
    // follow it, unlike the mirror/registry sources, which already guard every
    // hop (#334). There is no allowlist input for this source (the host is
    // always releases.hashicorp.com), so this always runs in DEFAULT-DENY mode:
    // any legitimate public redirect target is still allowed, only private/
    // link-local/reserved resolution is refused.
    const initialHost = new URL(downloadUrl).hostname;
    await assertEgressHostAllowed(initialHost, [], HASHICORP_EGRESS_MESSAGES);
    let zipPath: string;
    try {
        zipPath = path.join(tasks.getVariable('Agent.TempDirectory') || os.tmpdir(), fileName);
        await downloadToFile(downloadUrl, zipPath, DOWNLOAD_TIMEOUT_MS, hostname =>
            assertEgressHostAllowed(hostname, [], HASHICORP_EGRESS_MESSAGES));
    } catch (exception) {
        throw new Error(tasks.loc("PackerDownloadFailed", downloadUrl, exception));
    }

    const osPlatform = getPlatformString();
    const arch = getArchString();
    const zipFileName = `packer_${version}_${osPlatform}_${arch}.zip`;
    const sha256SumsUrl = `https://releases.hashicorp.com/packer/${version}/packer_${version}_SHA256SUMS`;
    const sha256SumsSigUrl = `${sha256SumsUrl}.sig`;

    const sha256SumsContent = await fetchText(sha256SumsUrl);
    const requireGpg = getBoolInputDefaultTrue("requireGpgSignature");
    // Verification failures discard the zip rather than leaving a rejected —
    // possibly tampered — artifact on the agent's disk (#204).
    await discardArtifactOnFailure(zipPath, async () => {
        await verifyGpgSignature(sha256SumsContent, sha256SumsSigUrl, requireGpg);
        await verifySha256(zipPath, parseSha256(sha256SumsContent, zipFileName));
    }, discardLog);

    return { zipPath, verified: true };
}

async function downloadZipFromRegistry(version: string, registryUrl: string, mirrorName: string): Promise<DownloadedZip> {
    // registryUrl may embed basic-auth userinfo; mask it before it can reach a log
    // via infoUrl in any error/warning below.
    maskOperatorUrlCredentials(registryUrl);
    const osPlatform = getPlatformString();
    const arch = getArchString();
    const infoUrl = `${registryUrl}/terraform/binaries/${mirrorName}/versions/${version}/${osPlatform}/${arch}`;
    const safeInfoUrl = redactUrlUserInfo(infoUrl);

    const data = await fetchJson<{ download_url: string; sha256: string }>(infoUrl);
    if (typeof data.download_url !== 'string' || !data.download_url) {
        throw new Error(`Registry API returned invalid response: missing download_url from ${safeInfoUrl}`);
    }
    // data.download_url = pre-signed storage URL (time-limited)
    // data.sha256       = hex SHA256 of the zip (may be empty if registry verified server-side)
    //
    // The pre-signed download_url carries a live, read-scoped storage credential in
    // its query string. tools.downloadTool logs the URL at INFO and only auto-redacts
    // Azure `sig=`, so AWS X-Amz-Signature/X-Amz-Credential/X-Amz-Security-Token and
    // GCS X-Goog-Signature/X-Goog-Credential would otherwise print unredacted on every
    // normal registry run. Register each token component as a secret FIRST — before
    // ANY emission that can carry the URL, including the https-pin rejection and the
    // egress-authorization refusal below, which used to interpolate the raw pre-signed
    // URL into their message while the registration still sat further down this
    // function (#66/#98).
    const urlTokenSecrets = extractUrlTokenSecrets(data.download_url);
    for (const secret of urlTokenSecrets) {
        tasks.setSecret(secret);
    }
    // The download URL is registry-controlled and fetched outside fetchJson's HTTPS
    // guard, so pin it to HTTPS before downloading — as the mirror path already does.
    if (!data.download_url.startsWith('https://')) {
        throw new Error(tasks.loc("InsecureUrlRejected", redactUrl(data.download_url)));
    }
    if (data.sha256 && !SHA256_HEX_PATTERN.test(data.sha256)) {
        throw new Error(`Registry API returned a malformed sha256 for ${safeInfoUrl}: expected 64 hex characters.`);
    }

    // Egress authorization for the registry-advertised download destination
    // (#161, sibling of terraform #729/#679/#769). download_url is chosen by the
    // registry at request time, not by the pipeline author, so a compromised or
    // misconfigured registry could point it — or a redirect from it — at a
    // loopback/link-local/private address, notably the cloud metadata service.
    // This path previously had NO host check at all and downloaded via
    // tools.downloadTool, which follows redirects with no way to re-validate
    // them. Default (registryAllowedHosts empty) is the baseline private/reserved
    // refusal; an operator whose registry legitimately serves from a private
    // storage host pins it explicitly, exactly as the mirror source does.
    const registryAllowedHosts = parseAllowedHosts(tasks.getInput("registryAllowedHosts", false));
    await assertEgressHostAllowed(new URL(data.download_url).hostname, registryAllowedHosts, REGISTRY_EGRESS_MESSAGES);

    const fileName = `${packerToolName}-${version}-${uuidV4()}.zip`;
    let zipPath: string;
    try {
        zipPath = path.join(tasks.getVariable('Agent.TempDirectory') || os.tmpdir(), fileName);
        await downloadToFile(data.download_url, zipPath, DOWNLOAD_TIMEOUT_MS, hostname =>
            assertEgressHostAllowed(hostname, registryAllowedHosts, REGISTRY_EGRESS_MESSAGES));
    } catch (exception) {
        // download_url is a pre-signed URL whose query string carries the signing
        // token; drop the whole query (redactUrl) and scrub the raw URL out of the
        // tool-lib exception text so the live credential never reaches the build log
        // via the failure message.
        const safeUrl = redactUrl(data.download_url);
        const safeMsg = scrubSecretsFromMessage(
            String(exception instanceof Error ? exception.message : exception),
            data.download_url,
            urlTokenSecrets,
        );
        throw new Error(tasks.loc("PackerDownloadFailed", safeUrl, safeMsg));
    }

    const requireChecksum = getBoolInputDefaultTrue("requireChecksum");
    if (data.sha256) {
        await discardArtifactOnFailure(zipPath, () => verifySha256(zipPath, data.sha256), discardLog);
        // The checksum matched, but it is the REGISTRY's own assertion about the
        // artifact, delivered over the same TLS session -- not a signature. The
        // hashicorp and mirror sources verify SHA256SUMS against the pinned
        // HashiCorp GPG key; this path has no signature verifier at all, and
        // requireGpgSignature does not apply to it (task.json hides the input via
        // visibleRule, which is UI-only). Say so rather than reporting a bare
        // success that reads identically to the GPG-anchored paths (#1024).
        tasks.warning(tasks.loc("RegistryTrustAnchorIsChecksumOnly", safeInfoUrl));
        return { zipPath, verified: true };
    }
    if (requireChecksum) {
        // A reachable registry deterministically withholding required material is a
        // policy failure, not an availability blip: typed so the cache-hit
        // re-verification path fails closed instead of degrading to the cached binary.
        throw new VerificationFailure(`Checksum verification is required but the registry did not provide a sha256 for ${safeInfoUrl}. Set 'requireChecksum' to false to trust the registry's server-side verification only.`);
    }
    tasks.warning(`The registry returned no sha256 for ${safeInfoUrl}; the binary is installed WITHOUT any local integrity verification (no checksum and the registry source performs no GPG check) — you are trusting the registry's server-side verification and TLS alone. Set 'requireChecksum' to true to require a local check.`);
    return { zipPath, verified: false };
}

async function downloadZipFromMirror(version: string, mirrorBaseUrl: string): Promise<DownloadedZip> {
    // mirrorBaseUrl may embed basic-auth userinfo; mask it before it can reach a log
    // via the rejection message or any URL derived from it below.
    maskOperatorUrlCredentials(mirrorBaseUrl);
    if (!mirrorBaseUrl.startsWith('https://')) {
        throw new Error(tasks.loc("InsecureUrlRejected", redactUrlUserInfo(mirrorBaseUrl)));
    }
    const osPlatform = getPlatformString();
    const arch = getArchString();
    // Mirror must serve files at the same path structure as releases.hashicorp.com/packer
    const downloadUrl = `${mirrorBaseUrl}/${version}/packer_${version}_${osPlatform}_${arch}.zip`;

    // Egress authorization for the mirror download destination. The SAME decision
    // (assertEgressHostAllowed) is applied to the initial URL and, via
    // downloadToFile, to every redirect hop. Previously the per-hop callback
    // re-checked only the textual private/link-local blocklist while the initial
    // check also resolved DNS, so a redirect to an ordinary-looking name that
    // resolves to 169.254.169.254 passed the hop check (#161/#191); the callback
    // was also invoked without being awaited, so an async rejection could not have
    // stopped the download even once it did resolve.
    const allowedHosts = parseAllowedHosts(tasks.getInput('mirrorAllowedHosts', false));
    const initialHost = new URL(downloadUrl).hostname;
    await assertEgressHostAllowed(initialHost, allowedHosts, MIRROR_EGRESS_MESSAGES);

    const fileName = `${packerToolName}-${version}-${uuidV4()}.zip`;
    let zipPath: string;
    try {
        zipPath = path.join(tasks.getVariable('Agent.TempDirectory') || os.tmpdir(), fileName);
        await downloadToFile(downloadUrl, zipPath, DOWNLOAD_TIMEOUT_MS, hostname =>
            assertEgressHostAllowed(hostname, allowedHosts, MIRROR_EGRESS_MESSAGES));
    } catch (exception) {
        throw new Error(tasks.loc("PackerDownloadFailed", redactUrlUserInfo(downloadUrl), exception));
    }

    const zipFileName = `packer_${version}_${osPlatform}_${arch}.zip`;
    const sha256SumsUrl = `${mirrorBaseUrl}/${version}/packer_${version}_SHA256SUMS`;
    // Every message below interpolates sha256SumsUrl, which inherits any
    // mirrorBaseUrl userinfo; render it credential-free (the userinfo is also
    // setSecret-masked by maskOperatorUrlCredentials above).
    const safeSha256SumsUrl = redactUrlUserInfo(sha256SumsUrl);
    const requireChecksum = getBoolInputDefaultTrue("requireChecksum");
    const requireGpg = getBoolInputDefaultTrue("requireGpgSignature");

    // A missing SHA256SUMS (HTTP 404) means the mirror published no checksum; any
    // other fetch error (5xx / network) is transient and left to throw (fatal).
    const sha256SumsContent = await fetchTextAllow404(sha256SumsUrl);
    if (sha256SumsContent === null) {
        if (requireChecksum) {
            throw new VerificationFailure(`Checksum verification is required but the mirror did not publish a SHA256SUMS file (${safeSha256SumsUrl}). Set 'requireChecksum' to false to install without it.`);
        }
        // The SHA256SUMS file IS the thing the GPG signature signs, so a mirror that
        // publishes none also makes GPG verification impossible. requireGpgSignature
        // must therefore be honored on THIS branch too: previously it was read only
        // further down, so with requireChecksum=false the mirror binary installed with
        // no checksum AND no signature while the toggle sat enabled and inert (#65).
        if (requireGpg) {
            throw new VerificationFailure(`GPG signature verification is required but the mirror published no SHA256SUMS file to verify (${safeSha256SumsUrl}). Set 'requireGpgSignature' to false for mirrors that do not serve signed checksums.`);
        }
        tasks.warning(`The mirror published no SHA256SUMS file (${safeSha256SumsUrl}); the binary is installed WITHOUT any local integrity verification. Set 'requireChecksum' to true to require it.`);
        return { zipPath, verified: false };
    }

    // SUMS is present: honor requireGpgSignature on the mirror path too (previously
    // GPG was only enforced on the hashicorp source — the toggle was inert here).
    await discardArtifactOnFailure(zipPath, () => verifyGpgSignature(sha256SumsContent, `${sha256SumsUrl}.sig`, requireGpg), discardLog);

    let expectedHash: string;
    try {
        // parseSha256 is OUTSIDE the discard wrapper on purpose: "this artifact is
        // not listed in the SUMS" is a checksum-UNAVAILABLE outcome the operator may
        // legitimately install through (requireChecksum=false), so the zip must
        // survive it. Only a real comparison failure discards.
        expectedHash = parseSha256(sha256SumsContent, zipFileName);
    } catch (error) {
        // The SUMS file did not list our artifact — treat as "unavailable".
        if (error instanceof ChecksumUnavailableError) {
            if (requireChecksum) {
                throw new VerificationFailure(`Checksum verification is required but ${zipFileName} is not listed in the mirror's SHA256SUMS (${safeSha256SumsUrl}).`);
            }
            tasks.warning(`${zipFileName} is not listed in the mirror's SHA256SUMS (${safeSha256SumsUrl}); skipping checksum verification. Set 'requireChecksum' to true to require it.`);
            return { zipPath, verified: false };
        }
        throw error;
    }
    // A genuine hash MISMATCH is always fatal, regardless of requireChecksum — and
    // the mismatched (possibly tampered) zip is deleted rather than left on disk.
    await discardArtifactOnFailure(zipPath, () => verifySha256(zipPath, expectedHash), discardLog);

    return { zipPath, verified: true };
}

// --- Helpers ---

export function parseSha256(sha256SumsContent: string, zipFileName: string): string {
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

export async function verifySha256(filePath: string, expectedHash: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new ChecksumMismatchError(tasks.loc("Sha256VerificationFailed", expectedHash, actualHash));
    }
    tasks.debug(`SHA256 verification passed: ${actualHash}`);
}

export function getCacheHashSidecarPath(packerPath: string): string {
    return `${packerPath}.sha256`;
}

/**
 * Records the freshly-downloaded-and-verified binary's hash so a future cache hit can
 * cheaply (no network) detect CORRUPTION of the agent's tool cache, or an entry cached
 * under a different verification policy, without a network round-trip (#136).
 *
 * Trust-boundary note (#136 reopen, 2026-08-25): the sidecar lives beside the binary
 * it protects, so an attacker who can rewrite the cached binary under the agent
 * account can rewrite the sidecar to match -- this is defense-in-depth against
 * corruption and cross-job verification-policy mixing, NOT a defense against an
 * attacker who already has write access to the agent's tool cache (who effectively
 * owns the agent). forceOnlineReverification exists for an operator who does not
 * accept that boundary on a given agent. Best-effort: a write failure only
 * debug-logs -- it must never fail an otherwise successful install.
 *
 * The write is ATOMIC (temp file in the same directory, then rename). A plain
 * writeFileSync interrupted mid-write -- agent disk full, job cancellation, a
 * container kill -- leaves a sidecar that exists and is readable but is empty or
 * truncated, and every subsequent install of this version then compares the real
 * digest against that fragment and fails with a tampering-shaped
 * Sha256VerificationFailed, permanently bricking the version on that agent (#198).
 * Renaming into place means a reader only ever sees a complete digest or none.
 */
export function recordCachedBinaryHash(packerPath: string): void {
    const sidecarPath = getCacheHashSidecarPath(packerPath);
    const tempPath = `${sidecarPath}.${uuidV4()}.tmp`;
    try {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(packerPath)).digest('hex');
        fs.writeFileSync(tempPath, hash, { mode: 0o600 });
        fs.renameSync(tempPath, sidecarPath);
    } catch (error) {
        tasks.debug(`Could not record a cache-integrity hash for ${packerPath}: ${error instanceof Error ? error.message : error}`);
        try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    }
}

/**
 * On a cache hit, cheaply (no network) re-verifies the cached binary against the hash
 * recorded when it was first downloaded and verified (#136).
 *
 * Returns TRUE only when a well-formed record existed and the cached binary matched
 * it. Returns FALSE for every "cannot check" outcome, which the caller escalates to a
 * remote re-verification rather than silently trusting:
 *
 *   - no sidecar (cached before this check existed, or cached by a run with
 *     verification disabled),
 *   - the sidecar cannot be stat'd or read,
 *   - the sidecar exists and is readable but is NOT a 64-character SHA256 digest.
 *
 * That last case is the one #198 names: an interrupted write (disk full, job
 * cancellation, container kill) leaves an empty or truncated sidecar. Feeding that
 * fragment to verifySha256 produces a ChecksumMismatchError -- by design never
 * downgradable -- so every later install of that version failed with
 * Sha256VerificationFailed, which reads as binary tampering and sends an operator
 * down a security-incident path for what is a torn file. A malformed record is
 * UNVERIFIABLE, not evidence of tampering; it is treated exactly like a missing one.
 * The record is NOT healed here -- healing happens only after the escalated
 * re-verification actually proves the cached binary.
 *
 * A genuine mismatch against a WELL-FORMED record always throws -- but see the
 * trust-boundary note on recordCachedBinaryHash: a match here proves the binary is
 * unchanged since IT WAS LAST RECORDED, which is not the same as proving it was
 * never tampered with by whoever could write both files together.
 */
export async function verifyCachedBinaryHash(packerPath: string): Promise<boolean> {
    const sidecarPath = getCacheHashSidecarPath(packerPath);
    let sidecarExists: boolean;
    try {
        sidecarExists = fs.existsSync(sidecarPath);
    } catch (error) {
        tasks.debug(`Could not check for a cache-integrity hash at ${sidecarPath}: ${error instanceof Error ? error.message : error}`);
        return false;
    }
    if (!sidecarExists) {
        tasks.debug(`No cache-integrity hash recorded for ${packerPath} yet (cached before this check existed, or cached without verification).`);
        return false;
    }
    let recordedHash: string;
    try {
        recordedHash = fs.readFileSync(sidecarPath, 'utf8').trim();
    } catch (error) {
        tasks.debug(`Could not read the cache-integrity hash at ${sidecarPath}: ${error instanceof Error ? error.message : error}`);
        return false;
    }
    if (!SHA256_HEX_PATTERN.test(recordedHash)) {
        tasks.debug(`The cache-integrity hash at ${sidecarPath} is not a 64-character SHA256 digest (${recordedHash.length} character(s) recorded); treating the cache entry as unverifiable rather than tampered.`);
        return false;
    }
    // A genuine mismatch (ChecksumMismatchError) always propagates -- that is real
    // local tampering/corruption, distinct from merely being unable to check.
    await verifySha256(packerPath, recordedHash);
    return true;
}

/**
 * A cache hit with NO usable integrity record means the tool was cached before the
 * record existed, by a job that ran with verification disabled, or with a record that
 * was torn on write. Under requireChecksum (default true) this job demands
 * verification, so re-download the release through the exact same source and
 * verification path a fresh install would use and require the cached executable to
 * byte-match the freshly verified one (#136):
 *
 *  - Source UNREACHABLE (network/DNS/TLS failure, timeout, 5xx, offline or air-gapped
 *    agent, version no longer published): degrade -- warn and keep the pre-existing
 *    trust-the-cache behaviour, so offline cache reuse keeps working. An operator on a
 *    shared persistent agent can opt out of that degradation with
 *    requireOnlineReverification.
 *  - Source REACHABLE but the material FAILS verification, or the reachable source
 *    WITHHOLDS material a require-flag makes mandatory: both surface as a typed
 *    VerificationFailure -- fail closed, never fall back to the cached copy.
 *  - Cached binary differs from the freshly verified release: fail closed.
 *  - Match: record the hash so future cache hits verify offline.
 */
async function reverifyUnmarkedCacheEntry(
    toolLabel: string,
    cachedPackerPath: string,
    downloadVerifiedZip: () => Promise<string>,
    reason: 'unmarked' | 'forced' = 'unmarked',
): Promise<void> {
    if (!getBoolInputDefaultTrue("requireChecksum")) {
        tasks.debug(reason === 'forced'
            ? `Cache hit for ${toolLabel}: forceOnlineReverification is enabled but requireChecksum is false; skipping remote re-verification.`
            : `Cache hit for ${toolLabel}: no usable cache-integrity hash and requireChecksum is false; skipping remote re-verification.`);
        return;
    }
    if (reason === 'forced') {
        console.log(tasks.loc("ForcingOnlineReverification", toolLabel));
    } else {
        console.log(tasks.loc("ReverifyingCachedTool", toolLabel));
    }
    let zipPath: string;
    try {
        zipPath = await downloadVerifiedZip();
    } catch (error) {
        if (isVerificationFailure(error)) {
            throw error;
        }
        // Default-false switch: task-lib's own getBoolInput is already case-insensitive
    // and defaults to false, which is exactly the opt-IN semantics wanted here.
    if (tasks.getBoolInput("requireOnlineReverification", false)) {
            throw new Error(tasks.loc("CachedToolReverificationSourceUnreachable", toolLabel, error instanceof Error ? error.message : String(error)));
        }
        tasks.warning(tasks.loc("CachedToolReverificationUnavailable", toolLabel, error instanceof Error ? error.message : String(error)));
        return;
    } finally {
        // downloadVerifiedZip records the source it fetched from; the binary this job
        // actually runs still comes from the cache -- re-assert that.
        tasks.setVariable('packerDownloadedFrom', 'cache');
    }
    const freshDir = await tools.extractZip(zipPath);
    const freshPackerPath = findPackerExecutable(freshDir);
    if (!freshPackerPath) {
        throw new Error(tasks.loc("PackerNotFoundInFolder", freshDir));
    }
    const freshHash = crypto.createHash('sha256').update(fs.readFileSync(freshPackerPath)).digest('hex').toLowerCase();
    const cachedHash = crypto.createHash('sha256').update(fs.readFileSync(cachedPackerPath)).digest('hex').toLowerCase();
    if (freshHash !== cachedHash) {
        throw new Error(tasks.loc("CachedToolReverificationMismatch", toolLabel, freshHash, cachedHash));
    }
    recordCachedBinaryHash(cachedPackerPath);
    console.log(tasks.loc("CachedToolReverified", toolLabel));
}

/**
 * Re-runs the configured source's download + verification exactly as a fresh install
 * would (same inputs, same toggles, same trust roots) and returns the verified zip.
 * Used only by the cache-hit re-verification path, which gates on requireChecksum=true
 * -- under which every strategy either verifies or throws.
 */
async function downloadVerifiedZipForReverify(downloadSource: string, version: string): Promise<string> {
    switch (downloadSource) {
        case "registry":
            return (await downloadZipFromRegistry(version, await getValidatedRegistryUrl(), getValidatedMirrorName())).zipPath;
        case "mirror":
            return (await downloadZipFromMirror(version, tasks.getInput("mirrorBaseUrl", true)!)).zipPath;
        default: // "hashicorp"
            return (await downloadZipFromHashiCorp(version)).zipPath;
    }
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
