import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	checkProductionProcessLaunchPolicy,
	formatProcessLaunchFindings,
} from './release/process-launch-policy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const findings = checkProductionProcessLaunchPolicy(rootDir);
if (findings.length > 0) {
	console.error('Plugin production process-launch policy failed:');
	console.error(formatProcessLaunchFindings(findings));
	process.exitCode = 1;
} else {
	console.log('Plugin production process-launch policy passed.');
}
