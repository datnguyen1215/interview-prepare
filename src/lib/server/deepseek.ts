import { DEEPSEEK_API_KEY } from '$app/env/private';

const URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[deepseek]', ...args);

export async function chat(messages: Message[], opts: { json?: boolean; maxTokens: number }): Promise<string> {
	if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not set; add it to .env');
	log('chat start', { model: MODEL, messages: messages.length, json: !!opts.json, maxTokens: opts.maxTokens });
	const t0 = Date.now();
	const res = await fetch(URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${DEEPSEEK_API_KEY}` },
		body: JSON.stringify({
			model: MODEL,
			messages,
			max_tokens: opts.maxTokens,
			...(opts.json && { response_format: { type: 'json_object' } })
		}),
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) {
		const text = await res.text();
		log('chat failed', { status: res.status, ms: Date.now() - t0, body: text.slice(0, 200) });
		throw new Error(`DeepSeek ${res.status}: ${text}`);
	}
	const data: { choices?: { message?: { content?: string } }[]; usage?: unknown } = await res.json();
	const content = data.choices?.[0]?.message?.content;
	if (typeof content !== 'string') throw new Error(`DeepSeek reply has no message content: ${JSON.stringify(data).slice(0, 200)}`);
	log('chat done', { model: MODEL, ms: Date.now() - t0, chars: content.length, usage: data.usage });
	return content;
}
