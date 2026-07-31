export const OPERON_RELEASE_MANIFEST_URL =
	'https://github.com/hasanyilmaz/operon/releases/latest/download/manifest.json';
export const OPERON_VERSIONS_URL =
	'https://raw.githubusercontent.com/hasanyilmaz/operon/main/versions.json';
export const OPERON_COMMUNITY_PLUGIN_URL = 'obsidian://show-plugin?id=operon';

interface PluginManifest {
	version?: string;
	minAppVersion?: string;
}

type VersionsManifest = Record<string, string>;

interface ParsedVersion {
	numbers: string[];
	prerelease: string[];
}

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export interface OperonReleaseCheckDependencies {
	requestJson: (url: string) => Promise<unknown>;
	canRunMinAppVersion: (minAppVersion: string) => boolean;
}

export function isValidOperonVersion(version: string): boolean {
	const match = SEMVER_PATTERN.exec(version.trim());
	if (!match) return false;
	const prerelease = match[4]?.split('.') ?? [];
	return prerelease.every(identifier => (
		!/^\d+$/u.test(identifier)
		|| identifier === '0'
		|| !identifier.startsWith('0')
	));
}

function parseVersion(version: string): ParsedVersion {
	const match = SEMVER_PATTERN.exec(version.trim());
	if (!match || !isValidOperonVersion(version)) {
		return { numbers: ['0', '0', '0'], prerelease: [] };
	}
	return {
		numbers: [match[1], match[2], match[3]],
		prerelease: match[4]?.split('.') ?? [],
	};
}

function compareNumericIdentifier(left: string, right: string): number {
	if (left.length !== right.length) return Math.sign(left.length - right.length);
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
	const leftIsNumber = /^\d+$/u.test(left);
	const rightIsNumber = /^\d+$/u.test(right);

	if (leftIsNumber && rightIsNumber) return compareNumericIdentifier(left, right);
	if (leftIsNumber) return -1;
	if (rightIsNumber) return 1;
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function compareOperonVersions(left: string, right: string): number {
	const leftVersion = parseVersion(left);
	const rightVersion = parseVersion(right);
	const length = Math.max(leftVersion.numbers.length, rightVersion.numbers.length, 3);

	for (let index = 0; index < length; index += 1) {
		const comparison = compareNumericIdentifier(
			leftVersion.numbers[index] ?? '0',
			rightVersion.numbers[index] ?? '0',
		);
		if (comparison !== 0) return comparison;
	}

	if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) return 0;
	if (leftVersion.prerelease.length === 0) return 1;
	if (rightVersion.prerelease.length === 0) return -1;

	const prereleaseLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
	for (let index = 0; index < prereleaseLength; index += 1) {
		const leftIdentifier = leftVersion.prerelease[index];
		const rightIdentifier = rightVersion.prerelease[index];
		if (leftIdentifier === undefined) return -1;
		if (rightIdentifier === undefined) return 1;
		const comparison = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
		if (comparison !== 0) return comparison;
	}

	return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeManifest(value: unknown): PluginManifest | null {
	if (!isRecord(value)) return null;
	const version = typeof value.version === 'string' ? value.version.trim() : '';
	if (!version) return null;
	return {
		version,
		minAppVersion: typeof value.minAppVersion === 'string' ? value.minAppVersion.trim() : undefined,
	};
}

function normalizeVersionsManifest(value: unknown): VersionsManifest {
	if (!isRecord(value)) return {};
	const versions: VersionsManifest = {};
	for (const [version, minAppVersion] of Object.entries(value)) {
		if (typeof minAppVersion === 'string' && version.trim()) versions[version] = minAppVersion;
	}
	return versions;
}

export function getLatestCompatibleOperonVersion(
	latestManifest: PluginManifest,
	versionsManifest: VersionsManifest,
	canRunMinAppVersion: (minAppVersion: string) => boolean,
): string | null {
	const latestVersion = latestManifest.version?.trim();
	if (!latestVersion) return null;
	if (!latestManifest.minAppVersion || canRunMinAppVersion(latestManifest.minAppVersion)) {
		return latestVersion;
	}

	const compatibleVersions = Object.entries(versionsManifest)
		.filter(([version, minAppVersion]) =>
			compareOperonVersions(version, latestVersion) <= 0
			&& canRunMinAppVersion(minAppVersion))
		.map(([version]) => version)
		.sort(compareOperonVersions);
	return compatibleVersions[compatibleVersions.length - 1] ?? null;
}

export function shouldNotifyForOperonRelease(
	currentVersion: string,
	availableVersion: string | null,
	lastNotifiedReleaseVersion: string,
): availableVersion is string {
	if (!availableVersion) return false;
	if (compareOperonVersions(availableVersion, currentVersion) <= 0) return false;
	return lastNotifiedReleaseVersion !== availableVersion;
}

export async function getAvailableOperonReleaseVersion(
	dependencies: OperonReleaseCheckDependencies,
): Promise<string | null> {
	const latestManifest = normalizeManifest(
		await dependencies.requestJson(OPERON_RELEASE_MANIFEST_URL),
	);
	if (!latestManifest) return null;

	if (!latestManifest.minAppVersion || dependencies.canRunMinAppVersion(latestManifest.minAppVersion)) {
		return latestManifest.version ?? null;
	}

	const versionsManifest = normalizeVersionsManifest(
		await dependencies.requestJson(OPERON_VERSIONS_URL),
	);
	return getLatestCompatibleOperonVersion(
		latestManifest,
		versionsManifest,
		dependencies.canRunMinAppVersion,
	);
}
