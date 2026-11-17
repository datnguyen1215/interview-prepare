import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ DEEPSEEK_API_KEY: 'sk-test' as string | undefined }));
vi.mock('$app/env/private', () => ({
	get DEEPSEEK_API_KEY() {
		return env.DEEPSEEK_API_KEY;
	}
}));

const { chat } = await import('./deepseek.js');

const ok = (content: string) =>
	new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 7 } }), { status: 200 });

afterEach(() => {
	vi.unstubAllGlobals();
	env.DEEPSEEK_API_KEY = 'sk-test';
});

describe('chat', () => {
	it('posts the model, messages, max tokens and json format with the key', async () => {
		const fetch = vi.fn().mockResolvedValue(ok('{"a":1}'));
		vi.stubGlobal('fetch', fetch);
		const out = await chat([{ role: 'user', content: 'hi' }], { json: true, maxTokens: 50 });
		expect(out).toBe('{"a":1}');
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('https://api.deepseek.com/chat/completions');
		expect(init.headers.authorization).toBe('Bearer sk-test');
		expect(init.signal).toBeInstanceOf(AbortSignal);
		expect(JSON.parse(init.body)).toEqual({
			model: 'deepseek-chat',
			messages: [{ role: 'user', content: 'hi' }],
			max_tokens: 50,
			response_format: { type: 'json_object' }
		});
	});

	it('omits response_format without json', async () => {
		const fetch = vi.fn().mockResolvedValue(ok('hello'));
		vi.stubGlobal('fetch', fetch);
		await chat([{ role: 'user', content: 'hi' }], { maxTokens: 200 });
		expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('response_format');
	});

	it('throws when the key is missing, without calling fetch', async () => {
		env.DEEPSEEK_API_KEY = undefined;
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		await expect(chat([], { maxTokens: 1 })).rejects.toThrow('DEEPSEEK_API_KEY is not set; add it to .env');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('throws with status and body on non-2xx', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
		await expect(chat([], { maxTokens: 1 })).rejects.toThrow('DeepSeek 401: bad key');
	});
});
