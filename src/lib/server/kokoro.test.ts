import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { say, status, stop } from './kokoro.js';

let dir: string;
let server: net.Server | undefined;
let lines: unknown[];
const original = process.env.XDG_RUNTIME_DIR;

function serve(reply: (req: { cmd: string }) => object) {
	const srv = net.createServer((sock) => {
		sock.once('data', (chunk) => {
			const req = JSON.parse(chunk.toString());
			lines.push(req);
			sock.end(JSON.stringify(reply(req)) + '\n');
		});
	});
	server = srv;
	return new Promise<void>((resolve) => srv.listen(path.join(dir, 'kokoro-speaker.sock'), resolve));
}

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kokoro-test-'));
	process.env.XDG_RUNTIME_DIR = dir;
	lines = [];
});

afterEach(async () => {
	await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
	server = undefined;
	process.env.XDG_RUNTIME_DIR = original;
	fs.rmSync(dir, { recursive: true, force: true });
});

describe('kokoro', () => {
	it('sends say, stop and status lines and parses status', async () => {
		await serve((req) => (req.cmd === 'status' ? { ok: true, speaking: true, queued: 2 } : { ok: true }));
		await say('Hello there');
		await stop();
		expect(await status()).toEqual({ speaking: true, queued: 2 });
		expect(lines).toEqual([{ cmd: 'say', text: 'Hello there' }, { cmd: 'stop' }, { cmd: 'status' }]);
	});

	it('throws the server error on ok:false', async () => {
		await serve(() => ({ ok: false, error: 'unknown command: say' }));
		await expect(say('x')).rejects.toThrow('kokoro say failed: unknown command: say');
	});

	it('throws naming the socket and the start command when the socket is missing', async () => {
		const sock = path.join(dir, 'kokoro-speaker.sock');
		await expect(stop()).rejects.toThrow(`kokoro-speaker not reachable at ${sock}`);
		await expect(stop()).rejects.toThrow('systemctl --user start kokoro-speaker');
	});

	it('throws when XDG_RUNTIME_DIR is unset', async () => {
		delete process.env.XDG_RUNTIME_DIR;
		await expect(status()).rejects.toThrow('XDG_RUNTIME_DIR is not set');
	});
});
