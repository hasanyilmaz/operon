import { TFile, type App } from 'obsidian';
import { resolveTaskMediaReference } from './task-media-reference';

export interface AssigneeImageSource {
	personPath: string;
	imagePath: string | null;
	src: string;
}

/** Read cached metadata only; null means keep the existing canonical icon. */
export function resolveAssigneeImageSource(
	app: App, assignee: string, taskPath: string, propertyName: string,
): AssigneeImageSource | null {
	const key = propertyName.trim();
	if (!key || !assignee.trim().startsWith('[[')) return null;
	const personReference = resolveTaskMediaReference(assignee);
	if (personReference.kind !== 'wikilink' || !personReference.target) return null;
	const person = app.metadataCache.getFirstLinkpathDest(personReference.target, taskPath);
	if (!(person instanceof TFile) || person.extension !== 'md') return null;
	const frontmatter = app.metadataCache.getFileCache(person)?.frontmatter;
	if (!frontmatter || !Object.prototype.hasOwnProperty.call(frontmatter, key)) return null;
	const value: unknown = frontmatter[key];
	if (typeof value !== 'string' || !value.trim()) return null;
	const image = resolveTaskMediaReference(value);
	if (!image.isOpenable || !image.target) return null;
	if (image.kind === 'http-url') return { personPath: person.path, imagePath: null, src: image.target };
	const file = app.metadataCache.getFirstLinkpathDest(image.target, person.path);
	if (!(file instanceof TFile) || !/^(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(file.extension)) return null;
	return { personPath: person.path, imagePath: file.path, src: app.vault.getResourcePath(file) };
}
