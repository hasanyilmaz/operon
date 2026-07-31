import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readOperonCliPackageVersion(pluginRoot) {
	const packageDocument = JSON.parse(await readFile(
		path.join(pluginRoot, 'packages', 'operon-cli', 'package.json'),
		'utf8',
	));
	if (packageDocument.name !== 'operon-cli' || typeof packageDocument.version !== 'string') {
		throw new Error('OPERON_CLI_TEST_PACKAGE_METADATA_INVALID');
	}
	return packageDocument.version;
}
