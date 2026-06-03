import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import { runAsyncAction } from '../core/async-action';
import { t } from '../core/i18n';
import {
	getReleaseBannerUrl,
	getYoutubeThumbnailUrl,
	getYoutubeVideoId,
} from '../core/release-notes';
import type { OperonReleaseNote } from '../core/release-notes';

interface OperonReleaseNotesModalOptions {
	onClose?: () => void | Promise<void>;
}

export class OperonReleaseNotesModal extends Modal {
	private releaseNotes: OperonReleaseNote[];
	private onCloseCallback?: () => void | Promise<void>;
	private hasRunCloseCallback = false;

	constructor(app: App, releaseNotes: OperonReleaseNote[], options: OperonReleaseNotesModalOptions = {}) {
		super(app);
		this.releaseNotes = releaseNotes;
		this.onCloseCallback = options.onClose;
	}

	onOpen(): void {
		const { contentEl, modalEl, titleEl } = this;
		contentEl.empty();
		modalEl.addClass('operon-release-notes-modal');
		titleEl.setText(t('modals', 'releaseNotesTitle'));

		const scrollEl = contentEl.createDiv('operon-release-notes-scroll');
		for (const note of this.releaseNotes) {
			this.renderReleaseNote(scrollEl, note);
		}

		contentEl.createDiv('operon-release-notes-divider');
		const footerEl = contentEl.createDiv('operon-release-notes-footer');
		footerEl.createEl('button', {
			text: t('buttons', 'stayInFlow'),
			cls: 'mod-cta operon-release-notes-thanks',
			attr: { type: 'button' },
		}).addEventListener('click', () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.hasRunCloseCallback) return;
		this.hasRunCloseCallback = true;
		runAsyncAction('release notes close callback failed', async () => {
			await this.onCloseCallback?.();
		});
	}

	private renderReleaseNote(containerEl: HTMLElement, note: OperonReleaseNote): void {
		const noteEl = containerEl.createDiv('operon-release-note');
		const headerEl = noteEl.createDiv('operon-release-note-header');
		if (note.title) {
			headerEl.createEl('h3', {
				text: note.title,
				cls: 'operon-release-note-title',
			});
		}
		headerEl.createEl('h4', {
			text: `${t('modals', 'releaseNotesVersion', { version: note.version })} (${formatReleaseDate(note.date)})`,
			cls: 'operon-release-note-version',
		});

		if (note.youtubeUrl) {
			this.renderYoutubeLink(noteEl, note.youtubeUrl);
		} else {
			const bannerUrl = getReleaseBannerUrl(note.bannerUrl, note.version);
			if (bannerUrl) this.renderReleaseBanner(noteEl, bannerUrl);
		}

		renderControlledMarkdown(noteEl, removeValidationSection(note.body));
	}

	private renderReleaseBanner(containerEl: HTMLElement, imageUrl: string): void {
		const bannerEl = containerEl.createDiv('operon-release-note-banner');
		const imageEl = bannerEl.createEl('img', {
			cls: 'operon-release-note-banner-image',
			attr: {
				alt: '',
				loading: 'lazy',
				decoding: 'async',
			},
		});
		imageEl.addEventListener('error', () => {
			bannerEl.remove();
		});
		imageEl.src = imageUrl;
	}

	private renderYoutubeLink(containerEl: HTMLElement, youtubeUrl: string): void {
		const linkEl = containerEl.createEl('a', {
			cls: 'operon-release-note-youtube-link',
			attr: {
				href: youtubeUrl,
				rel: 'noopener noreferrer',
				target: '_blank',
				'aria-label': t('modals', 'releaseNotesOpenVideo'),
			},
		});
		const thumbnailEl = linkEl.createDiv('operon-release-note-youtube-thumbnail');
		const videoId = getYoutubeVideoId(youtubeUrl);
		if (videoId) {
			const imageEl = thumbnailEl.createEl('img', {
				cls: 'operon-release-note-youtube-image',
				attr: {
					alt: t('modals', 'releaseNotesOpenVideo'),
					loading: 'lazy',
				},
			});
			let usedFallback = false;
			imageEl.addEventListener('error', () => {
				if (usedFallback) return;
				usedFallback = true;
				imageEl.src = getYoutubeThumbnailUrl(videoId, 'hqdefault.jpg');
			});
			imageEl.src = getYoutubeThumbnailUrl(videoId, 'maxresdefault.jpg');
		} else {
			thumbnailEl.createDiv({
				text: t('modals', 'releaseNotesOpenVideo'),
				cls: 'operon-release-note-youtube-placeholder',
			});
		}
		thumbnailEl.createDiv('operon-release-note-youtube-play').setAttribute('aria-hidden', 'true');
	}
}

function formatReleaseDate(date: string): string {
	const parsed = new Date(`${date}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return date;
	const year = parsed.getFullYear();
	const month = String(parsed.getMonth() + 1).padStart(2, '0');
	const day = String(parsed.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function renderControlledMarkdown(containerEl: HTMLElement, markdown: string): void {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	let paragraphLines: string[] = [];
	let activeList: HTMLElement | null = null;

	const flushParagraph = (): void => {
		if (paragraphLines.length === 0) return;
		const paragraphEl = containerEl.createEl('p', { cls: 'operon-release-note-paragraph' });
		renderInlineMarkdown(paragraphEl, paragraphLines.join(' '));
		paragraphLines = [];
	};

	const closeList = (): void => {
		activeList = null;
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			flushParagraph();
			closeList();
			continue;
		}

		const headingMatch = /^(#{2,3})\s+(.+)$/u.exec(line);
		if (headingMatch) {
			flushParagraph();
			closeList();
			const headingClassName = getReleaseNoteHeadingClassName(headingMatch[2]);
			const headingEl = headingMatch[1] === '##'
				? containerEl.createEl('h4', { cls: headingClassName })
				: containerEl.createEl('h5', { cls: headingClassName });
			renderInlineMarkdown(headingEl, headingMatch[2]);
			continue;
		}

		if (line.startsWith('- ')) {
			flushParagraph();
			if (!activeList) {
				activeList = containerEl.createEl('ul', { cls: 'operon-release-note-list' });
			}
			const itemEl = activeList.createEl('li');
			renderInlineMarkdown(itemEl, line.slice(2).trim());
			continue;
		}

		closeList();
		paragraphLines.push(line);
	}

	flushParagraph();
}

function getReleaseNoteHeadingClassName(text: string): string {
	const normalized = text.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
	const knownHeading = ['new', 'improved', 'changed', 'fixed', 'removed', 'security'].includes(normalized)
		? ` operon-release-note-heading-${normalized}`
		: '';
	return `operon-release-note-heading${knownHeading}`;
}

function removeValidationSection(markdown: string): string {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const keptLines: string[] = [];
	let isSkipping = false;

	for (const rawLine of lines) {
		const headingMatch = /^(#{2,3})\s+(.+)$/u.exec(rawLine.trim());
		if (headingMatch) {
			isSkipping = headingMatch[2].trim().toLowerCase() === 'validation';
			if (isSkipping) continue;
		}
		if (!isSkipping) {
			keptLines.push(rawLine);
		}
	}

	return keptLines.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function renderInlineMarkdown(containerEl: HTMLElement, text: string): void {
	const pattern = /==([\s\S]*?)==|\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/gu;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	const appendText = (value: string): void => {
		if (value) containerEl.appendText(value);
	};

	while ((match = pattern.exec(text)) !== null) {
		appendText(text.slice(lastIndex, match.index));

		if (match[1]) {
			const highlightEl = containerEl.createSpan({ cls: 'operon-release-note-highlight' });
			renderInlineMarkdown(highlightEl, match[1]);
		} else if (match[2]) {
			containerEl.createEl('strong', { text: match[2] });
		} else if (match[3]) {
			containerEl.createEl('code', { text: match[3] });
		} else if (match[4] && match[5]) {
			createExternalLink(containerEl, match[4], match[5]);
		} else if (match[6]) {
			const { url, trailing } = splitTrailingUrlPunctuation(match[6]);
			createExternalLink(containerEl, url, url);
			appendText(trailing);
		}

		lastIndex = pattern.lastIndex;
	}

	appendText(text.slice(lastIndex));
}

function createExternalLink(containerEl: HTMLElement, label: string, url: string): void {
	containerEl.createEl('a', {
		text: label,
		attr: {
			href: url,
			rel: 'noopener noreferrer',
			target: '_blank',
		},
	});
}

function splitTrailingUrlPunctuation(url: string): { url: string; trailing: string } {
	const match = /[.,;:!?)]+$/u.exec(url);
	if (!match) return { url, trailing: '' };
	const trailing = match[0];
	return {
		url: url.slice(0, -trailing.length),
		trailing,
	};
}
