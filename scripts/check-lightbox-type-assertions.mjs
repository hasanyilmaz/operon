import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLightboxTypeAssertionCheck } from './release/lightbox-type-assertion-policy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.exitCode = await runLightboxTypeAssertionCheck(rootDir);
