import { isYoutubeHostname, parseYoutubeVideoUrl } from './youtube-url';

export type TaskMediaPreviewKind = 'image' | 'video' | 'pdf' | 'youtube' | 'unknown';

const TASK_MEDIA_IMAGE_EXTENSIONS = new Set([
	'avif',
	'bmp',
	'gif',
	'jpeg',
	'jpg',
	'png',
	'svg',
	'webp',
]);
const TASK_MEDIA_VIDEO_EXTENSIONS = new Set([
	'mkv',
	'mov',
	'mp4',
	'ogv',
	'webm',
]);

export function classifyLocalTaskMediaPreview(extension: string): TaskMediaPreviewKind {
	const normalized = extension.trim().replace(/^\./u, '').toLowerCase();
	if (TASK_MEDIA_IMAGE_EXTENSIONS.has(normalized)) return 'image';
	if (TASK_MEDIA_VIDEO_EXTENSIONS.has(normalized)) return 'video';
	if (normalized === 'pdf') return 'pdf';
	return 'unknown';
}

export function classifyExternalTaskMediaPreviewUrl(value: string): TaskMediaPreviewKind {
	if (parseYoutubeVideoUrl(value)) return 'youtube';
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return 'unknown';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unknown';
	if (isYoutubeHostname(url.hostname)) return 'unknown';
	const fileName = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
	const dotIndex = fileName.lastIndexOf('.');
	const extension = dotIndex >= 0 ? fileName.slice(dotIndex + 1) : '';
	const classified = classifyLocalTaskMediaPreview(extension);
	// Preserve the established remote-image behavior for extensionless CDN and
	// query-heavy URLs. The image element remains the load-success authority.
	return extension === '' ? 'image' : classified;
}
