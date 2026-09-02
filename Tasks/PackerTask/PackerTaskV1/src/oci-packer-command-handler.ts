import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import {
    EnvironmentVariableHelper,
    exchangeOidcForUpst,
    generateIdToken,
    maskSecretLines,
    validateIdentityDomainUrl,
} from '@4cloudguru/pipeline-task-ado';
import { normalizePem } from '@4cloudguru/pipeline-task-core';
import crypto = require('crypto');
import os = require('os');
import path = require('path');
import {
    assertIdentityValue,
    FINGERPRINT_PATTERN,
    neutralizeEnvironmentVariables,
    OCID_PATTERN,
    REGION_PATTERN,
    requireIdentityField,
    requireSecretField,
    requireServiceConnection,
    TENANCY_OCID_PATTERN,
} from './credential-guards';

/**
 * OCI SDK configuration the packer-plugin-oracle builder honours ahead of, or
 * instead of, the PKR_VAR_oci_* values this handler injects. Cleared so an
 * inherited config file or profile on a self-hosted agent cannot redirect the
 * build to a different tenancy/user (#187).
 */
const OCI_COMPETING_CREDENTIAL_ENV = [
    'OCI_CLI_CONFIG_FILE',
    'OCI_CLI_PROFILE',
    'OCI_CLI_AUTH',
    'OCI_CLI_TENANCY',
    'OCI_CLI_USER',
    'OCI_CLI_FINGERPRINT',
    'OCI_CLI_KEY_FILE',
    'OCI_CLI_REGION',
] as const;

/**
 * A path that never exists (#333). packer-plugin-oracle's own
 * `ComposingConfigurationProvider` tries providers in order and uses the
 * first that returns no error PER FIELD (verified against upstream
 * oci-go-sdk's `common/configuration.go`) -- the explicit values this
 * handler injects always occupy provider index 0, so as long as they're all
 * non-empty (guaranteed by requireIdentityField/requireSecretField below), a
 * `~/.oci/config` on the agent is never actually consulted for any field
 * this handler supplies. But when `access_cfg_file` is left unset (the
 * default -- this handler injects no value for it today), the plugin's
 * `Prepare()` still calls `getDefaultOCISettingsPath()` and, if that file
 * exists, always attempts to read and parse it as a SECOND provider before
 * discarding it. Pinning `access_cfg_file` to a path that can never resolve
 * removes that read entirely rather than relying on every required field
 * staying non-empty forever -- defense in depth against a future regression
 * in the guards below, not a fix for a live substitution today.
 *
 * BEST-EFFORT ON THIS BRANCH, NOT GUARANTEED (#391). The pin travels as a
 * PKR_VAR_, and Packer silently ignores a PKR_VAR_ naming a variable the
 * template never declared. The documented API-key template declares five
 * oci_* variables and not this one (docs/yaml-examples.md), so for that
 * template -- and every template written before the declaration existed --
 * the pin is a no-op and the agent's ~/.oci/config IS read as a second
 * provider. It cannot be promoted to `-var` the way the WIF branch does:
 * that would hard-fail every existing OCI pipeline. Templates that do
 * declare the variable get the defense; the rest keep the field-level
 * guards, which are what actually prevent substitution today.
 */
const OCI_ACCESS_CFG_FILE_DISABLED = path.join(os.tmpdir(), '.packer-task-oci-access-cfg-file-intentionally-absent');

/**
 * The API-key branch's own PKR_VAR_* selectors, cleared by the WIF branch.
 *
 * WIF authenticates entirely through the synthetic config file, and the plugin
 * resolves each field from the FIRST provider that returns no error: an
 * inherited PKR_VAR_oci_user_ocid would be picked up by the raw provider at
 * index 0 and defeat the fall-through to the config file that the session
 * token depends on.
 *
 * PKR_VAR_oci_pass_phrase is load-bearing rather than decorative: the plugin
 * passes the HCL pass_phrase to ConfigurationProviderFromFileWithProfile, and
 * the ephemeral key this handler writes is unencrypted PKCS#8 -- an inherited
 * passphrase would make the file provider try to decrypt it and fail.
 */
const OCI_API_KEY_VAR_ENV = [
    'PKR_VAR_oci_tenancy_ocid',
    'PKR_VAR_oci_user_ocid',
    'PKR_VAR_oci_region',
    'PKR_VAR_oci_fingerprint',
    'PKR_VAR_oci_key_file',
    'PKR_VAR_oci_pass_phrase',
] as const;

/** The WIF branch's own selectors, cleared by the API-key branch (the mirror image). */
const OCI_WIF_VAR_ENV = [
    'PKR_VAR_oci_access_cfg_file_account',
    'PKR_VAR_oci_security_token_file',
] as const;

/**
 * The auth-MODE switch, cleared by BOTH branches (#391). Distinct in kind from
 * the two selector sets above: those choose an identity, this chooses a
 * mechanism, so neither branch owns it and neither may leave it standing.
 *
 * use_instance_principals is mutually exclusive with every field either branch
 * injects -- the plugin appends a MultiError entry for each non-empty one
 * (config.go:191-223), so an inherited `true` on a self-hosted agent fails
 * Prepare() with six errors on the API-key branch and two on WIF, all naming
 * fields the pipeline author never set and none pointing at the environment.
 * Fail-closed, but hostile to diagnose. There is no valid run with a service
 * connection configured in which this is true, so clearing it can only turn a
 * confusing failure into a working build.
 *
 * Note the deliberate asymmetry with PKR_VAR_oci_pass_phrase, which is in
 * OCI_API_KEY_VAR_ENV and so is cleared by WIF only. WIF must clear it (its
 * ephemeral key is unencrypted PKCS#8 and the plugin hands the passphrase to
 * ConfigurationProviderFromFileWithProfile, config.go:272). The API-key branch
 * must NOT: the OCI service connection has no passphrase field, making this
 * variable the only channel for an encrypted service-connection key. The
 * symmetry is tempting and would break that configuration.
 */
const OCI_AUTH_MODE_VAR_ENV = [
    'PKR_VAR_oci_use_instance_principals',
] as const;

/**
 * Injects OCI credentials for the packer-plugin-oracle (oracle-oci) builder
 * using the PKR_VAR_* convention: the API-key fields from the OCI service
 * connection are exposed as Packer variables, and the private key is written to
 * a restrictive temp file referenced by PKR_VAR_oci_key_file. Templates declare
 * matching `variable "oci_*"` blocks and wire them to the builder source.
 */
export class PackerCommandHandlerOCI extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "oci";
    }

    private writeKeyFile(privateKey: string): string {
        // Mask the raw value LINE-WISE first. setSecret rejects multi-line input
        // (LIB_MultilineSecret): the UI passwordbox strips newlines on paste, but
        // a service connection created via the REST API / az devops CLI can
        // deliver a genuine multi-line PEM, in which case setSecret on the raw
        // value throws before any credential is written AND leaves the raw form
        // unregistered. No boundary-line filtering here: the flattened
        // single-line form is itself one "line" that starts with "-----BEGIN".
        // Mirrors gcp-packer-command-handler.ts and the terraform extension's
        // getPrivateKeyFilePath().
        maskSecretLines(privateKey);
        const normalized = normalizePem(privateKey);
        // setSecret masks exact substrings within a single log line. normalizePem
        // rewrites the key to a byte-different LF-wrapped form — the form actually
        // written to disk and referenced by PKR_VAR_oci_key_file — so also register
        // each base64 body line of that on-disk form. setSecret rejects multi-line
        // input, hence per line rather than the whole PEM.
        for (const line of normalized.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('-----')) {
                tasks.setSecret(trimmed);
            }
        }
        return this.writeTrackedSecretFile('oci-keyfile', 'pem', normalized);
    }

    /**
     * Workload Identity Federation: exchange the ADO OIDC token for an OCI User
     * Principal Session Token (UPST) and hand the plugin a synthetic OCI config
     * file that references it, instead of a long-lived API key.
     *
     * WHY A FILE, AND WHY -var. packer-plugin-oracle reads none of
     * OCI_CLI_CONFIG_FILE / OCI_CLI_PROFILE / OCI_CLI_AUTH -- verified against
     * builder/oci/config.go, where getDefaultOCISettingsPath() hard-codes
     * ~/.oci/config and the only override is the `access_cfg_file` HCL field.
     * (Its `security_token_file` HCL field is declared but never read, so it
     * cannot be used either.) Session-token auth is still reachable, but only
     * through the config file: ComposingConfigurationProvider resolves each
     * field from the first provider that returns no error, rawConfigurationProvider
     * errors on every empty field, and fileConfigurationProvider.KeyID() returns
     * "ST$<token>" for a profile carrying security_token_file and no user. So
     * leaving the API-key fields empty makes all five of the plugin's Prepare()
     * gates resolve against this file.
     *
     * The path is delivered as `-var` (see providerVarArgs) rather than
     * PKR_VAR_, because an undeclared PKR_VAR_ is silently skipped: a template
     * missing `variable "oci_access_cfg_file"` would ignore the credential and
     * fall through to whatever ambient config the agent has. `-var` makes
     * Packer refuse the run instead.
     */
    private async handleProviderWIF(command: PackerAuthorizationCommandInitializer): Promise<void> {
        // Read and validate EVERY input before minting anything. A federated
        // assertion is a live bearer credential the instant it exists, so a
        // config error must be caught before step 1 requests one -- not
        // discovered afterwards with a usable token already in hand.
        const identityDomainUrl = validateIdentityDomainUrl(
            assertIdentityValue(tasks.getInput("ociWifIdentityDomainUrl", true), "Input 'ociWifIdentityDomainUrl'")
        ).href;
        const clientId = assertIdentityValue(tasks.getInput("ociWifClientId", true), "Input 'ociWifClientId'");
        const tenancyOcid = assertIdentityValue(tasks.getInput("ociWifTenancyOcid", true), "Input 'ociWifTenancyOcid'", TENANCY_OCID_PATTERN, 'tenancy OCID');
        const region = assertIdentityValue(tasks.getInput("ociWifRegion", true), "Input 'ociWifRegion'", REGION_PATTERN, 'region identifier');

        // Fail closed like the API-key path rather than requesting an OIDC token
        // for an empty service connection id.
        const wifServiceName = requireServiceConnection(command.serviceProviderName, 'OCI', 'environmentServiceNameOCI', 'for Workload Identity Federation');

        const oidcToken = await generateIdToken(wifServiceName);
        tasks.setSecret(oidcToken);

        // Ephemeral RSA key pair: OCI binds the issued UPST to it, and the
        // plugin signs subsequent API requests with the private half.
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: { type: 'spki', format: 'pem' },
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });
        // ADO's masker matches within a single log line, so register the key
        // line-wise; setSecret rejects multi-line input outright.
        maskSecretLines(privateKey);

        const upst = await exchangeOidcForUpst(oidcToken, identityDomainUrl, clientId, publicKey);
        tasks.setSecret(upst);

        // The fingerprint OCI expects for a session-token profile is the MD5 of
        // the ephemeral public key's SPKI DER, colon-grouped.
        const der = crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
        const md5 = crypto.createHash('md5').update(der).digest('hex');
        const fingerprint = md5.match(/.{2}/g)!.join(':');

        const privateKeyPath = this.writeTrackedSecretFile('oci-wif-key', 'pem', privateKey);
        const upstPath = this.writeTrackedSecretFile('oci-wif-upst', 'jwt', upst);

        // `fingerprint` is present only to satisfy the plugin's non-empty
        // KeyFingerprint() gate -- it plays no part in ST$ session-token auth.
        // Do not remove it as dead: Prepare() fails without it.
        const configContent = [
            '[DEFAULT]',
            `tenancy=${tenancyOcid}`,
            `region=${region}`,
            `key_file=${privateKeyPath}`,
            `fingerprint=${fingerprint}`,
            `security_token_file=${upstPath}`,
        ].join('\n') + '\n';
        const configPath = this.writeTrackedSecretFile('oci-wif-config', 'ini', configContent);

        neutralizeEnvironmentVariables(
            [...OCI_COMPETING_CREDENTIAL_ENV, ...OCI_API_KEY_VAR_ENV, ...OCI_AUTH_MODE_VAR_ENV],
            "OCI Workload Identity Federation");

        // Delivered as a command-line variable, which fails closed on a template
        // that never declared it. The account/profile name stays an environment
        // variable: the plugin already defaults it to DEFAULT, matching this
        // file's section header, so requiring a second declared variable would
        // be friction with no fail-closed value.
        this.providerVarArgs.push(`oci_access_cfg_file=${configPath}`);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_access_cfg_file", configPath);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_access_cfg_file_account", "DEFAULT");
    }

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const authScheme = tasks.getInput("environmentAuthSchemeOCI", false) || "ServiceConnection";
        this.validateAuthScheme(authScheme, "environmentAuthSchemeOCI");

        if (authScheme === "WorkloadIdentityFederation") {
            await this.handleProviderWIF(command);
            return;
        }

        const serviceName = requireServiceConnection(command.serviceProviderName, 'OCI', 'environmentServiceNameOCI');

        // The privatekey descriptor now lives under the endpoint's auth scheme, so
        // ADO delivers it as ENDPOINT_AUTH_PARAMETER_*: vaulted by task-lib, removed
        // from process.env, and seeded into the agent's masker at job start. None of
        // that is true of ENDPOINT_DATA_*, which is also debug-logged at read time by
        // tasks.getEndpointDataParameter (#185/#195).
        //
        // Connections created before that change still carry the value as endpoint
        // data, so the read falls back to the hardened readSecretEndpointDataParameter
        // rather than failing. Fails closed on an absent/empty key either way (#199).
        const rawPrivateKey = requireSecretField(serviceName, "privateKey", { source: 'auth-migrating-from-data' });
        const keyFilePath = this.writeKeyFile(rawPrivateKey);

        // The strict per-field grammars this handler pioneered now live in the
        // shared credential-guards module, so the Azure/AWS/vSphere/GCP handlers
        // apply the same "reject missing/newline-bearing/malformed before it
        // reaches an injected environment variable" contract (#199).
        const tenancyOcid = requireIdentityField(serviceName, "tenancy", { source: 'data', pattern: OCID_PATTERN, description: 'OCID' });
        const userOcid = requireIdentityField(serviceName, "user", { source: 'data', pattern: OCID_PATTERN, description: 'OCID' });
        const region = requireIdentityField(serviceName, "region", { source: 'data', pattern: REGION_PATTERN, description: 'region identifier' });
        const fingerprint = requireIdentityField(serviceName, "fingerprint", { source: 'data', pattern: FINGERPRINT_PATTERN, description: 'key fingerprint' });

        neutralizeEnvironmentVariables(
            [...OCI_COMPETING_CREDENTIAL_ENV, ...OCI_WIF_VAR_ENV, ...OCI_AUTH_MODE_VAR_ENV],
            "OCI API key");
        // @credential-exempt: the OCI API-key branch cannot be pre-flighted the way
        // Azure is (#332), because there is no single variable whose absence proves
        // the credential was dropped -- a template may legitimately wire some oci_*
        // values and pin others in the source block. The consequence also differs:
        // the field guards above keep every injected value non-empty, so the raw
        // configuration provider occupies index 0 and answers before the file
        // provider, making a dropped PKR_VAR_ a loss of defense-in-depth rather than
        // a live substitution. The residual -- an ambient ~/.oci/config being read as
        // a second provider when the template declares none of these -- is already
        // stated in the OCI_ACCESS_CFG_FILE_DISABLED comment above and in #391.
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_tenancy_ocid", tenancyOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_user_ocid", userOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_region", region);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_fingerprint", fingerprint);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_key_file", keyFilePath);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_access_cfg_file", OCI_ACCESS_CFG_FILE_DISABLED);
    }
}
