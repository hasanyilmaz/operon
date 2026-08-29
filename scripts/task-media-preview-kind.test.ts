import assert from 'node:assert/strict';
import {
	classifyExternalTaskMediaPreviewUrl,
	classifyLocalTaskMediaPreview,
} from '../src/core/task-media-preview-kind';
import { OPERON_RELEASE_NOTES } from '../src/core/release-notes';
import {
	getYoutubeEmbedUrl,
	getYoutubeThumbnailUrl,
	getYoutubeVideoId,
	parseYoutubeVideoUrl,
} from '../src/core/youtube-url';

assert.equal(classifyLocalTaskMediaPreview('png'), 'image');
assert.equal(classifyLocalTaskMediaPreview('.SVG'), 'image');
for (const extension of ['mkv', 'mov', 'mp4', 'ogv', 'webm']) {
	assert.equal(classifyLocalTaskMediaPreview(extension), 'video');
}
assert.equal(classifyLocalTaskMediaPreview('pdf'), 'pdf');
assert.equal(classifyLocalTaskMediaPreview('md'), 'unknown');

assert.equal(
	classifyExternalTaskMediaPreviewUrl('https://cdn.example.test/media/clip.MP4?download=1#time=20'),
	'video',
);
assert.equal(
	classifyExternalTaskMediaPreviewUrl('https://cdn.example.test/docs/guide.pdf?page=2#page=3'),
	'pdf',
);
assert.equal(classifyExternalTaskMediaPreviewUrl('https://cdn.example.test/render?id=cover'), 'image');
assert.equal(classifyExternalTaskMediaPreviewUrl('https://www.youtube.com/watch?v=abcdefghijk'), 'youtube');
assert.equal(classifyExternalTaskMediaPreviewUrl('https://cdn.example.test/archive.zip'), 'unknown');
assert.equal(classifyExternalTaskMediaPreviewUrl('javascript:alert(1)'), 'unknown');
assert.equal(classifyExternalTaskMediaPreviewUrl('not a url'), 'unknown');

assert.deepEqual(
	parseYoutubeVideoUrl('https://youtu.be/abcdefghijk?si=tracking&t=1m30s'),
	{ videoId: 'abcdefghijk', startSeconds: 90 },
);
assert.deepEqual(
	parseYoutubeVideoUrl('https://www.youtube.com/watch?v=abcdefghijk&start=45'),
	{ videoId: 'abcdefghijk', startSeconds: 45 },
);
assert.deepEqual(
	parseYoutubeVideoUrl('https://www.youtube.com/watch?v=abcdefghijk#t=2m5s'),
	{ videoId: 'abcdefghijk', startSeconds: 125 },
);
for (const url of [
	'https://m.youtube.com/shorts/abcdefghijk',
	'https://music.youtube.com/live/abcdefghijk',
	'https://youtube.com/v/abcdefghijk',
	'https://www.youtube.com/embed/abcdefghijk',
	'https://www.youtube-nocookie.com/embed/abcdefghijk',
]) {
	assert.equal(getYoutubeVideoId(url), 'abcdefghijk');
}
for (const url of [
	'https://youtube.com/playlist?list=PL123',
	'https://youtube.com/results?search_query=operon',
	'https://youtube.com/watch?v=short',
	'https://youtube.com.evil.test/watch?v=abcdefghijk',
	'https://youtu.be/abcdefghijk/extra',
]) {
	assert.equal(parseYoutubeVideoUrl(url), null);
}
assert.equal(classifyExternalTaskMediaPreviewUrl('https://youtube.com/playlist?list=PL123'), 'unknown');
assert.equal(
	getYoutubeEmbedUrl({ videoId: 'abcdefghijk', startSeconds: 90 }),
	'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=0&playsinline=1&start=90',
);
assert.equal(getYoutubeThumbnailUrl('abcdefghijk', 'hqdefault.jpg'), 'https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg');
assert.equal(OPERON_RELEASE_NOTES.length, 5);
for (const releaseNote of OPERON_RELEASE_NOTES) {
	if (releaseNote.youtubeUrl) assert.notEqual(getYoutubeVideoId(releaseNote.youtubeUrl), null);
}

console.log('Task media preview kind tests passed');
