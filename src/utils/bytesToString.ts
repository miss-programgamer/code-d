/**
 * Converts a buffer (UTF-8 or UTF-16 LE with BOM) to a JS string.
 * Contains code for other UTF encodings, which are not supported by NodeJS
 * yet however.
 */
export default function bytesToString(bytes: Uint8Array): string {
	let buffer = Buffer.from(bytes);
	let encoding: BufferEncoding = 'utf8';
	if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
		buffer = buffer.subarray(3);
	} else if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xFE && bytes[3] === 0xFF) {
		buffer = buffer.subarray(4);
		encoding = 'utf32be' as BufferEncoding;
	} else if (bytes[0] === 0xFF && bytes[1] === 0xFE && bytes[2] === 0x00 && bytes[3] === 0x00) {
		buffer = buffer.subarray(4);
		encoding = 'utf32le' as BufferEncoding;
	} else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
		buffer = buffer.subarray(2);
		encoding = 'utf16be' as BufferEncoding;
	} else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
		buffer = buffer.subarray(2);
		encoding = 'utf16le';
	}

	return buffer.toString(encoding);
}