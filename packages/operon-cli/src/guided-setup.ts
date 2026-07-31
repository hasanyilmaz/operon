import { realpathSync } from 'node:fs';
import { basename, dirname, parse } from 'node:path';

import type {
	OperonCliConfigV1,
} from './config';
import {
	validateOperonManifestV1,
} from './config';
import type { InteractiveTerminalPortV1 } from './terminal-port';
import { sanitizeTerminalTextV1 } from './terminal-text';

const VAULT_DISCOVERY_DEPTH_LIMIT = 32;

export interface GuidedSetupSelectionV1 {
	vaultPath: string;
	name: string;
	makeDefault: boolean;
	verifyLive: boolean;
}

export type GuidedSetupResultV1 =
	| { status: 'cancelled'; message: string }
	| { status: 'ready'; selection: GuidedSetupSelectionV1 };

export async function runGuidedSetupWizardV1(options: {
	port: InteractiveTerminalPortV1;
	config: OperonCliConfigV1;
	cwd: string;
}): Promise<GuidedSetupResultV1> {
	const { port, config } = options;
	port.write('Set up Operon CLI\n\n');
	const discovered = discoverOperonVaultFromCwdV1(options.cwd);
	let vaultPath = discovered;
	if (vaultPath) {
		port.write(`Found an Operon vault in the current workspace: ${sanitizePathLabel(vaultPath)}\n`);
		const useDiscovered = await askYesNo(port, 'Use this vault?', true);
		if (useDiscovered === null) return cancelled();
		if (!useDiscovered) vaultPath = null;
	}
	while (!vaultPath) {
		const answer = await port.ask('Exact Obsidian vault path, or q to cancel: ');
		if (isCancelled(answer)) return cancelled();
		try {
			const canonical = realpathSync(answer!.trim());
			validateOperonManifestV1(canonical);
			vaultPath = canonical;
		} catch {
			port.write(
				'That path is not an accessible Obsidian vault with one unambiguous Operon plugin installation.\n',
			);
		}
	}

	const existing = config.profiles.find(profile => profile.canonicalPath === vaultPath);
	const derived = existing?.name ?? deriveProfileAliasV1(basename(vaultPath));
	let name = derived;
	if (!existing && config.profiles.length > 0) {
		while (true) {
			const answer = await port.ask(`Profile alias [${derived}]: `);
			if (isCancelled(answer)) return cancelled();
			const candidate = answer!.trim() || derived;
			if (
				/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(candidate)
				&& !config.profiles.some(profile => (
					profile.name === candidate && profile.canonicalPath !== vaultPath
				))
			) {
				name = candidate;
				break;
			}
			port.write('Choose a unique alias using letters, numbers, dots, underscores, or hyphens.\n');
		}
	}
	const verifyLive = await askYesNo(port, 'Verify live Runtime now?', true);
	if (verifyLive === null) return cancelled();
	return {
		status: 'ready',
		selection: {
			vaultPath,
			name,
			makeDefault: config.profiles.length === 0,
			verifyLive,
		},
	};
}

export function discoverOperonVaultFromCwdV1(cwd: string): string | null {
	let current: string;
	try {
		current = realpathSync(cwd);
	} catch {
		return null;
	}
	for (let depth = 0; depth < VAULT_DISCOVERY_DEPTH_LIMIT; depth += 1) {
		try {
			validateOperonManifestV1(current);
			return current;
		} catch {
			// Continue upward until one exact Operon config directory is found.
		}
		const parent = dirname(current);
		if (parent === current || current === parse(current).root) break;
		current = parent;
	}
	return null;
}

export function deriveProfileAliasV1(value: string): string {
	const normalized = value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 64)
		.replace(/-+$/gu, '');
	return normalized || 'vault';
}

export function completionHintForShellV1(shell?: string): string | undefined {
	const name = shell ? basename(shell) : '';
	if (name === 'zsh' || name === 'bash' || name === 'fish') {
		return `Optional completion: operon completion ${name}`;
	}
	return undefined;
}

function sanitizePathLabel(value: string): string {
	return sanitizeTerminalTextV1(value).slice(0, 240);
}

async function askYesNo(
	port: InteractiveTerminalPortV1,
	prompt: string,
	defaultValue: boolean,
): Promise<boolean | null> {
	while (true) {
		const answer = await port.ask(`${prompt} ${defaultValue ? '[Y/n]' : '[y/N]'} `);
		if (answer === null || answer.trim().toLowerCase() === 'q') return null;
		const value = answer.trim().toLowerCase();
		if (!value) return defaultValue;
		if (value === 'y' || value === 'yes') return true;
		if (value === 'n' || value === 'no') return false;
		port.write('Enter y, n, or q.\n');
	}
}

function isCancelled(answer: string | null): boolean {
	return answer === null || answer.trim().toLowerCase() === 'q';
}

function cancelled(): GuidedSetupResultV1 {
	return { status: 'cancelled', message: 'Operon setup cancelled.' };
}
