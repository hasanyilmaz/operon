export interface YoutubeVideoReference {
	videoId: string;
	startSeconds?: number;
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_PATH_KINDS = new Set(['embed', 'live', 'shorts', 'v']);

export function isYoutubeHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/\.+$/u, '');
	return normalized === 'youtu.be'
		|| normalized === 'youtube.com'
		|| normalized.endsWith('.youtube.com')
		|| normalized === 'youtube-nocookie.com'
		|| normalized.endsWith('.youtube-nocookie.com');
}

export function parseYoutubeVideoUrl(value: string): YoutubeVideoReference | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isYoutubeHostname(url.hostname)) return null;

	const hostname = url.hostname.toLowerCase().replace(/\.+$/u, '');
	const segments = url.pathname.split('/').filter(Boolean);
	let videoId: string | null = null;
	if (hostname === 'youtu.be') {
		videoId = segments.length === 1 ? segments[0] ?? null : null;
	} else if (url.pathname === '/watch') {
		videoId = url.searchParams.get('v');
	} else if (segments.length === 2 && YOUTUBE_PATH_KINDS.has(segments[0] ?? '')) {
		videoId = segments[1] ?? null;
	}
	if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) return null;

	const startSeconds = resolveYoutubeStartSeconds(url);
	return startSeconds === null ? { videoId } : { videoId, startSeconds };
}

export function getYoutubeVideoId(value: string): string | null {
	return parseYoutubeVideoUrl(value)?.videoId ?? null;
}

export function getYoutubeThumbnailUrl(videoId: string, quality: string): string {
	return `https://img.youtube.com/vi/${videoId}/${quality}`;
}

export function getYoutubeEmbedUrl(reference: YoutubeVideoReference): string {
	const url = new URL(`https://www.youtube-nocookie.com/embed/${reference.videoId}`);
	url.searchParams.set('autoplay', '0');
	url.searchParams.set('playsinline', '1');
	if (reference.startSeconds !== undefined) {
		url.searchParams.set('start', String(reference.startSeconds));
	}
	return url.toString();
}

function resolveYoutubeStartSeconds(url: URL): number | null {
	for (const candidate of [url.searchParams.get('start'), url.searchParams.get('t')]) {
		const parsed = parseYoutubeTimestamp(candidate);
		if (parsed !== null) return parsed;
	}
	const hashParams = new URLSearchParams(url.hash.replace(/^#/u, ''));
	return parseYoutubeTimestamp(hashParams.get('t'));
}

function parseYoutubeTimestamp(value: string | null): number | null {
	if (!value) return null;
	if (/^\d+$/u.test(value)) return toSafePositiveSeconds(Number(value));
	const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
	if (!match || match[0] === '') return null;
	const seconds = Number(match[1] ?? 0) * 3600
		+ Number(match[2] ?? 0) * 60
		+ Number(match[3] ?? 0);
	return toSafePositiveSeconds(seconds);
}

function toSafePositiveSeconds(value: number): number | null {
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}
