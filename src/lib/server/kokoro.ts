import net from 'node:net';

type Reply = { ok: boolean; error?: string; speaking?: boolean; queued?: number };
type Request = { cmd: 'say'; text: string } | { cmd: 'stop' } | { cmd: 'status' };

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[kokoro]', ...args);

function socketPath(): string {
	const dir = process.env.XDG_RUNTIME_DIR;
	if (!dir) throw new Error('XDG_RUNTIME_DIR is not set; cannot locate interview-kokoro.sock');
	return `${dir}/interview-kokoro.sock`;
}

function send(req: Request): Promise<Reply> {
	const path = socketPath();
	const t0 = Date.now();
	log('send', req.cmd, req.cmd === 'say' ? { chars: req.text.length } : '');
	return new Promise((resolve, reject) => {
		const sock = net.createConnection(path);
		let buf = '';
		sock.setTimeout(5000, () => sock.destroy(new Error(`kokoro ${req.cmd} timed out after 5000 ms at ${path}`)));
		sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
		sock.on('data', (chunk) => {
			buf += chunk.toString();
			const nl = buf.indexOf('\n');
			if (nl < 0) return;
			sock.end();
			const reply: Reply = JSON.parse(buf.slice(0, nl));
			log('reply', req.cmd, { ms: Date.now() - t0, ...reply });
			if (!reply.ok) return reject(new Error(`kokoro ${req.cmd} failed: ${reply.error}`));
			resolve(reply);
		});
		sock.on('error', (e: NodeJS.ErrnoException) => {
			log('error', req.cmd, { path, ms: Date.now() - t0, code: e.code, message: e.message });
			if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED')
				return reject(new Error(`kokoro not reachable at ${path} (${e.code}); start it with tts/run.sh`));
			reject(e);
		});
	});
}

export async function say(text: string): Promise<void> {
	await send({ cmd: 'say', text });
}

export async function stop(): Promise<void> {
	await send({ cmd: 'stop' });
}

export async function status(): Promise<{ speaking: boolean; queued: number }> {
	const r = await send({ cmd: 'status' });
	return { speaking: r.speaking === true, queued: r.queued ?? 0 };
}
