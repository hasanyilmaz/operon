import assert from 'node:assert/strict';
import {
	compareOperonVersions,
	getAvailableOperonReleaseVersion,
	OPERON_RELEASE_MANIFEST_URL,
	OPERON_VERSIONS_URL,
	shouldNotifyForOperonRelease,
} from '../src/systems/release-check';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	equal(compareOperonVersions('2.3.0', '2.2.1'), 1);
	equal(compareOperonVersions('2.3.0-beta.2', '2.3.0-beta.10'), -1);
	equal(compareOperonVersions('2.3.0', '2.3.0-beta.10'), 1);
	equal(compareOperonVersions('2.3.0+build.1', '2.3.0'), 0);
	equal(compareOperonVersions('2.3.0-beta.2+build.4', '2.3.0-beta.2+build.9'), 0);
	equal(shouldNotifyForOperonRelease('2.3.0', '2.4.0', ''), true);
	equal(shouldNotifyForOperonRelease('2.3.0', '2.4.0', '2.4.0'), false);
	equal(shouldNotifyForOperonRelease('2.3.0', '2.3.0', ''), false);

	const compatibleRequests: string[] = [];
	const compatible = await getAvailableOperonReleaseVersion({
		requestJson: async url => {
			compatibleRequests.push(url);
			return { version: '2.4.0', minAppVersion: '1.7.2' };
		},
		canRunMinAppVersion: () => true,
	});
	equal(compatible, '2.4.0');
	equal(compatibleRequests.length, 1);
	equal(compatibleRequests[0], OPERON_RELEASE_MANIFEST_URL);

	const fallbackRequests: string[] = [];
	const compatibleFallback = await getAvailableOperonReleaseVersion({
		requestJson: async url => {
			fallbackRequests.push(url);
			if (url === OPERON_RELEASE_MANIFEST_URL) {
				return { version: '3.0.0', minAppVersion: '2.0.0' };
			}
			return {
				'2.3.0': '1.7.2',
				'2.4.0': '1.8.0',
				'3.0.0': '2.0.0',
				'3.1.0': '1.7.2',
			};
		},
		canRunMinAppVersion: minAppVersion => minAppVersion !== '2.0.0',
	});
	equal(compatibleFallback, '2.4.0');
	equal(fallbackRequests.length, 2);
	equal(fallbackRequests[1], OPERON_VERSIONS_URL);

	const invalid = await getAvailableOperonReleaseVersion({
		requestJson: async () => ({ minAppVersion: '1.7.2' }),
		canRunMinAppVersion: () => true,
	});
	equal(invalid, null);

	console.log(`Release-check tests passed: ${assertions} assertions`);
}

declare global {
	var __operonReleaseCheckTestRun: Promise<void> | undefined;
}

globalThis.__operonReleaseCheckTestRun = run();
