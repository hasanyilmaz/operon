import test from 'node:test';
import { settingsVersionBackupCases } from './test-support/settings-version-backup-cases';
for (const { name, run } of settingsVersionBackupCases) test(name, { concurrency: 1 }, run);
