import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERON_PRODUCTION_PERSISTENT_READ } from '../operon-build-config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.resolve(rootDir, process.argv[2] ?? 'main.js');
const productionBundlePath = path.join(rootDir, 'main.js');
const persistentReadAllowed = process.argv.includes('--allow-persistent-read')
	|| (
		bundlePath === productionBundlePath
		&& OPERON_PRODUCTION_PERSISTENT_READ
	);
const source = readFileSync(bundlePath, 'utf8');
const forbiddenMarkers = [
	'operon:transport-probe',
	'Usage:\\n  operon health --vault',
	'"settings-refresh"',
	'"pre-read-settlement"',
	'"semantic-postflight"',
	'"receipt-persist"',
	'receipt-admission-',
	'receipt-terminal-',
	'node-api-load',
	'secure-request-consume',
	'running-vault-identity',
	...(
		persistentReadAllowed
			? []
			: [
				'persistent-read-server-start-failed',
				'persistent-read-descriptor-not-secure',
				'persistent-read-socket-not-secure',
			]
	),
];

const marker = forbiddenMarkers.find(candidate => source.includes(candidate));
if (marker) {
	console.error(`Operon Agent Runtime bundle guard failed: ${bundlePath} contains ${marker}.`);
	process.exitCode = 1;
} else {
	console.log(
		`Operon Agent Runtime bundle guard passed: ${bundlePath} is `
		+ `probe-, timing-, and ${persistentReadAllowed ? 'candidate-safe' : 'persistent-read-free'}.`,
	);
}
