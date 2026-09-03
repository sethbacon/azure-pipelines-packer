import tasks = require('azure-pipelines-task-lib/task');
import fs = require('fs');
import path = require('path');
import { isWithinWorkingDirectory } from './path-containment';

/**
 * The output-variable boundary: everything template- or build-influenced passes
 * through here before it becomes a pipeline variable. Extracted from
 * BasePackerCommandHandler (#113).
 *
 * These are free functions rather than a class because nothing here holds state
 * and no subclass overrides any of it — `setBuildOutputs` takes the working
 * directory it needs as a parameter instead of reaching for `this`.
 */

/** Upper bound on a template-controlled value before it becomes a pipeline output variable. */
export const OUTPUT_VAR_MAX_LENGTH = 1024;

/**
 * Upper bound on the manifest file itself before it is read into memory and
 * JSON.parse'd (#101). The manifest post-processor's output is
 * build-template-controlled: a template that appends unbounded post-processor
 * entries (or simply points manifestFile at a large artifact) would otherwise
 * be buffered whole and parsed. A real manifest is a few KB per build.
 */
export const MANIFEST_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Caps length and requires printable-ASCII content before a template- or
 * build-influenced value becomes a pipeline output variable. Returns null when
 * the value must not be exported.
 *
 * OutputBoundaryClassL0 asserts on Windows -- where the behavioural test cannot
 * run, because NTFS cannot hold '\n' in a directory name -- that every
 * setVariable of a resolved path is fed from this function. Keep the call sites
 * in the shape `const safe<X> = sanitizeOutputVariableValue(resolved);`
 * immediately followed by the matching setVariable, or that structural
 * substitute stops proving anything.
 */
export function sanitizeOutputVariableValue(value: string): string | null {
    if (!value || value.length > OUTPUT_VAR_MAX_LENGTH) return null;
    return /^[\x20-\x7E]+$/.test(value) ? value : null;
}

/**
 * If a `manifestFile` input is set, reads the Packer `manifest` post-processor
 * output and exposes the last build's artifact id and the manifest path as
 * pipeline output variables. No-op when the manifest is absent or unparseable.
 */
export function setBuildOutputs(workingDirectory: string): void {
    const manifestFile = tasks.getInput("manifestFile", false);
    if (!manifestFile) return;

    const resolved = path.resolve(workingDirectory, manifestFile);
    if (!isWithinWorkingDirectory(resolved, workingDirectory)) {
        tasks.warning(`manifestFile '${manifestFile}' resolves outside the working directory (${resolved}); skipping build output variables.`);
        return;
    }
    if (!fs.existsSync(resolved)) {
        // Explicitly configured by the user -- a missing manifest usually means
        // the template's manifest post-processor block is missing/misconfigured,
        // which should be diagnosable from this step's own log, not debug-only (#106).
        tasks.warning(`Manifest file not found at ${resolved}; skipping build output variables.`);
        return;
    }
    try {
        const size = fs.statSync(resolved).size;
        if (size > MANIFEST_MAX_BYTES) {
            tasks.warning(`Manifest file ${resolved} is ${size} bytes, above the ${MANIFEST_MAX_BYTES}-byte cap; skipping build output variables.`);
            return;
        }
        const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
        const safeManifestPath = sanitizeOutputVariableValue(resolved);
        if (safeManifestPath) {
            tasks.setVariable('manifestFilePath', safeManifestPath, false, true);
        } else {
            tasks.warning(`manifestFilePath '${resolved}' failed output-variable validation (length/printable-ASCII); skipping manifestFilePath output variable.`);
        }

        const builds = manifest.builds;
        if (Array.isArray(builds) && builds.length > 0) {
            const last = builds[builds.length - 1];
            const artifactId = last?.artifact_id;
            if (typeof artifactId === 'string' || typeof artifactId === 'number') {
                const safeArtifactId = sanitizeOutputVariableValue(String(artifactId));
                if (safeArtifactId) {
                    tasks.setVariable('artifactId', safeArtifactId, false, true);
                    tasks.debug(`Set artifactId output variable: ${safeArtifactId}`);
                } else {
                    tasks.warning(`Manifest artifact_id failed output-variable validation (length/printable-ASCII); skipping artifactId output variable.`);
                }
            } else if (artifactId !== undefined) {
                tasks.debug(`Manifest artifact_id is not a string or number (${typeof artifactId}); skipping artifactId output variable.`);
            }
        }
    } catch (err) {
        // Explicitly configured by the user -- a parse failure means the
        // manifest post-processor produced corrupt/unexpected JSON, which
        // should be diagnosable from this step's own log, not debug-only (#106).
        tasks.warning(`Could not parse Packer manifest for build outputs: ${err}`);
    }
}
