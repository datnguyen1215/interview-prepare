import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from './deepseek.js';

const chat = vi.hoisted(() => vi.fn());
vi.mock('./deepseek.js', () => ({ chat }));

const { nextTurn, preparePlan } = await import('./interviewer.js');

const plan = { role: 'Backend Engineer', level: 'Senior', stack: ['Go', 'Kafka'], questions: ['Q one?', 'Q two?'] };
const sent = (): Message[] => chat.mock.calls[0][0];
const allText = () => sent().map((m) => m.content).join('\n');

beforeEach(() => chat.mockReset());

describe('preparePlan', () => {
	it('returns a validated plan from a json chat', async () => {
		chat.mockResolvedValue(JSON.stringify(plan));
		expect(await preparePlan('Senior Go engineer')).toEqual(plan);
		expect(chat.mock.calls[0][1]).toMatchObject({ json: true });
		expect(sent().at(-1)).toEqual({ role: 'user', content: 'Senior Go engineer' });
	});

	it('rejects empty questions, quoting the reply', async () => {
		chat.mockResolvedValue(JSON.stringify({ ...plan, questions: [] }));
		await expect(preparePlan('x')).rejects.toThrow('"questions":[]');
	});

	it('rejects non-string questions', async () => {
		chat.mockResolvedValue(JSON.stringify({ ...plan, questions: ['ok', 3] }));
		await expect(preparePlan('x')).rejects.toThrow('missing role, level, stack or questions');
	});

	it('rejects non-JSON with the first 200 chars', async () => {
		chat.mockResolvedValue('nope'.repeat(100));
		const err = await preparePlan('x').catch((e: Error) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe(`plan reply is not JSON: ${'nope'.repeat(50)}`);
	});
});

describe('nextTurn', () => {
	it('greets and asks question 1 on empty history', async () => {
		chat.mockResolvedValue(' Hi, tell me about Q one? ');
		expect(await nextTurn(plan, [], 'next')).toBe('Hi, tell me about Q one?');
		expect(sent()[0].role).toBe('system');
		expect(sent()[0].content).toContain('1. Q one?\n2. Q two?');
		expect(sent()[0].content).toContain('Senior Backend Engineer');
		expect(sent().at(-1)?.content).toMatch(/greet.*question 1/i);
		expect(chat.mock.calls[0][1]).toEqual({ maxTokens: 200 });
	});

	it('maps interviewer and hint to assistant and you to user', async () => {
		chat.mockResolvedValue('Next?');
		await nextTurn(
			plan,
			[
				{ who: 'interviewer', text: 'Q one?' },
				{ who: 'hint', text: 'Think about load' },
				{ who: 'you', text: 'I used Kafka' }
			],
			'next'
		);
		expect(sent().slice(1)).toEqual([
			{ role: 'assistant', content: 'Q one?' },
			{ role: 'assistant', content: '(hint) Think about load' },
			{ role: 'user', content: 'I used Kafka' }
		]);
	});

	it('hint asks for a nudge without the answer', async () => {
		chat.mockResolvedValue('Think about partitions.');
		await nextTurn(plan, [{ who: 'interviewer', text: 'Q one?' }], 'hint');
		expect(sent().at(-1)?.content).toMatch(/nudge/i);
		expect(sent().at(-1)?.content).toMatch(/do not give the answer/i);
	});

	it('forbids grading and never asks for a score', async () => {
		chat.mockResolvedValue('ok');
		await nextTurn(plan, [], 'next');
		chat.mockResolvedValue(JSON.stringify(plan));
		await preparePlan('x');
		const prompts = chat.mock.calls.flatMap((c) => (c[0] as Message[]).map((m) => m.content)).join('\n');
		expect(allText()).toMatch(/never grade, score, rate or give feedback/i);
		const withoutRule = prompts.replace(/never grade, score, rate or give feedback[^\n]*/gi, '');
		expect(withoutRule).not.toMatch(/score|grade|rate|feedback/i);
	});
});
