import test from 'node:test';
import { settingsPreservationCases } from './test-support/settings-preservation-cases';

for (const { name, run } of settingsPreservationCases) {
 test(name, { concurrency: 1 }, run);
}
