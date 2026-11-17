import fs from 'node:fs';
import { Readable } from 'node:stream';
import { recordingPath } from '#lib/server/recordings.js';
import type { RequestHandler } from './$types';

// Range support is required for seeking in the <video> player.
export const GET: RequestHandler = ({ params, request }) => {
	const file = recordingPath(params.name);
	const { size } = fs.statSync(file);
	const range = request.headers.get('range');
	const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' };

	if (!range) {
		const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
		return new Response(body, { headers: { ...headers, 'Content-Length': String(size) } });
	}

	const [startStr, endStr] = range.replace('bytes=', '').split('-');
	const start = Number(startStr);
	const end = endStr ? Number(endStr) : size - 1;
	const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
	return new Response(body, {
		status: 206,
		headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
	});
};
