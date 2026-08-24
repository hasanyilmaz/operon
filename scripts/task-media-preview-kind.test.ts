import assert from 'node:assert/strict';
import {
	classifyExternalTaskMediaPreviewUrl,
	classifyLocalTaskMediaPreview,
} from '../src/core/task-media-preview-kind';

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
assert.equal(classifyExternalTaskMediaPreviewUrl('https://www.youtube.com/watch?v=abcdefghijk'), 'image');
assert.equal(classifyExternalTaskMediaPreviewUrl('https://cdn.example.test/archive.zip'), 'unknown');
assert.equal(classifyExternalTaskMediaPreviewUrl('javascript:alert(1)'), 'unknown');
assert.equal(classifyExternalTaskMediaPreviewUrl('not a url'), 'unknown');

console.log('Task media preview kind tests passed');
