declare const __OPERON_CLI_PACKAGE_NAME__: string;

export const OPERON_CLI_PACKAGE_NAME = typeof __OPERON_CLI_PACKAGE_NAME__ === 'string'
	? __OPERON_CLI_PACKAGE_NAME__
	: '@stratejya/operon-cli';
