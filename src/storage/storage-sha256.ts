export async function sha256HexForStorage(value: string): Promise<string> {
	const subtle = crypto?.subtle;
	if (!subtle) throw new Error('SHA-256 is unavailable for storage recovery.');
	const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('');
}
