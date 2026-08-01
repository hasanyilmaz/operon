import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	assertOperonCliPackageDocumentV1,
} from '../../../packages/operon-cli/package-identity.mjs';

export async function readOperonCliPackageVersion(pluginRoot) {
	const packageDocument = assertOperonCliPackageDocumentV1(JSON.parse(await readFile(
		path.join(pluginRoot, 'packages', 'operon-cli', 'package.json'),
		'utf8',
	)), 'OPERON_CLI_TEST_PACKAGE_METADATA_INVALID');
	return packageDocument.version;
}
