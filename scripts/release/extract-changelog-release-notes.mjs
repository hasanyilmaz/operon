import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const RELEASE_HEADING_PATTERN = /^## \[((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})$/u;
const BRACKET_HEADING_PATTERN = /^## \[([^\]]+)\]/u;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

function isValidIsoDate(value) {
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function collectTopLevelHeadings(markdown) {
	const normalized = markdown.replace(/\r\n?/gu, '\n');
	const headings = [];
	let fence;
	let htmlComment = false;
	let offset = 0;

	for (const line of normalized.split('\n')) {
		const fenceMatch = line.match(FENCE_PATTERN);
		if (fence) {
			if (
				fenceMatch
				&& fenceMatch[1][0] === fence.marker
				&& fenceMatch[1].length >= fence.length
				&& fenceMatch[2].trim() === ''
			) {
				fence = undefined;
			}
		} else if (htmlComment) {
			if (line.includes('-->')) htmlComment = false;
		} else if (line.includes('<!--')) {
			const commentStart = line.indexOf('<!--');
			if (!line.includes('-->', commentStart + 4)) htmlComment = true;
			if (line.slice(0, commentStart).trim() !== '') {
				const visiblePrefix = line.slice(0, commentStart).trimEnd();
				if (/^##(?:\s|$)/u.test(visiblePrefix)) {
					headings.push({
						end: offset + visiblePrefix.length,
						line: visiblePrefix,
						start: offset,
					});
				}
			}
		} else if (fenceMatch) {
			fence = {
				length: fenceMatch[1].length,
				marker: fenceMatch[1][0],
			};
		} else if (/^##(?:\s|$)/u.test(line)) {
			headings.push({
				end: offset + line.length,
				line,
				start: offset,
			});
		}
		offset += line.length + 1;
	}
	return { headings, normalized };
}

export function extractChangelogReleaseNotes(changelog, version) {
	if (!VERSION_PATTERN.test(version)) {
		throw new Error('OPERON_RELEASE_NOTES_VERSION_INVALID');
	}

	const { headings, normalized } = collectTopLevelHeadings(changelog);
	const releases = [];
	for (const heading of headings) {
		if (heading.line === '## [Unreleased]') continue;
		if (!BRACKET_HEADING_PATTERN.test(heading.line)) continue;

		const match = heading.line.match(RELEASE_HEADING_PATTERN);
		if (!match || !isValidIsoDate(match[2])) {
			throw new Error('OPERON_RELEASE_NOTES_HEADING_INVALID');
		}
		releases.push({
			...heading,
			version: match[1],
		});
	}

	const matches = releases.filter(release => release.version === version);
	if (matches.length === 0) {
		throw new Error('OPERON_RELEASE_NOTES_VERSION_MISSING');
	}
	if (matches.length !== 1) {
		throw new Error('OPERON_RELEASE_NOTES_VERSION_DUPLICATE');
	}

	const selected = matches[0];
	const selectedIndex = headings.findIndex(heading => heading.start === selected.start);
	const bodyEnd = headings[selectedIndex + 1]?.start ?? normalized.length;
	const body = normalized.slice(selected.end, bodyEnd)
		.replace(/^\n+/u, '')
		.trimEnd();
	if (body.length === 0) {
		throw new Error('OPERON_RELEASE_NOTES_BODY_EMPTY');
	}
	return `${body}\n`;
}

function parseArguments(argv) {
	const options = {
		changelog: 'CHANGELOG.md',
		out: '',
		version: '',
	};
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`Missing value for ${flag ?? 'argument'}.`);
		}
		if (flag === '--changelog') options.changelog = value;
		else if (flag === '--out') options.out = value;
		else if (flag === '--version') options.version = value;
		else throw new Error(`Unknown argument: ${flag}`);
	}
	if (!options.out || !options.version) {
		throw new Error('Usage: extract-changelog-release-notes.mjs --version X.Y.Z --out <path>');
	}
	return options;
}

export async function writeChangelogReleaseNotes(argv = process.argv.slice(2)) {
	const options = parseArguments(argv);
	const changelog = await readFile(path.resolve(options.changelog), 'utf8');
	const notes = extractChangelogReleaseNotes(changelog, options.version);
	await writeFile(path.resolve(options.out), notes, 'utf8');
}

const scriptPath = fileURLToPath(import.meta.url);
if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	await writeChangelogReleaseNotes();
}
