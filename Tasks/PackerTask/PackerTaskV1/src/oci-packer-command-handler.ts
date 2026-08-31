import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper, maskSecretLines } from '@4cloudguru/pipeline-task-ado';
import { normalizePem } from '@4cloudguru/pipeline-task-core';
import os = require('os');
import path = require('path');
import {
    FINGERPRINT_PATTERN,
    neutralizeEnvironmentVariables,
    OCID_PATTERN,
    REGION_PATTERN,
    requireIdentityField,
    requireSecretField,
    requireServiceConnection,
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
 */
const OCI_ACCESS_CFG_FILE_DISABLED = path.join(os.tmpdir(), '.packer-task-oci-access-cfg-file-intentionally-absent');

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

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
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

        neutralizeEnvironmentVariables(OCI_COMPETING_CREDENTIAL_ENV, "OCI API key");
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_tenancy_ocid", tenancyOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_user_ocid", userOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_region", region);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_fingerprint", fingerprint);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_key_file", keyFilePath);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_access_cfg_file", OCI_ACCESS_CFG_FILE_DISABLED);
    }
}
