export const OPERON_CLI_NPM_PACKAGE_NAME = '@stratejya/operon-cli';
export const OPERON_CLI_NPM_PACKAGE_PATH = Object.freeze(['@stratejya', 'operon-cli']);

const SEMVER_V1 = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;

export function assertOperonCliPackageDocumentV1(packageDocument, errorCode = 'OPERON_CLI_PACKAGE_METADATA_INVALID') {
	if (
		packageDocument?.name !== OPERON_CLI_NPM_PACKAGE_NAME
		|| typeof packageDocument.version !== 'string'
		|| !SEMVER_V1.test(packageDocument.version)
	) {
		throw new Error(errorCode);
	}
	return packageDocument;
}

export function operonCliTarballFileNameV1(version) {
	if (typeof version !== 'string' || !SEMVER_V1.test(version)) {
		throw new Error('OPERON_CLI_PACKAGE_VERSION_INVALID');
	}
	return `stratejya-operon-cli-${version}.tgz`;
}
