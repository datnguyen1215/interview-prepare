<script lang="ts">
	import type { Check } from './devices.svelte.js';

	let { check }: { check: Check } = $props();
</script>

<div class="dev">
	{#if check.state === 'ok'}
		<span class="ok" aria-label="ok">✓</span>
	{:else if check.state === 'fail'}
		<span class="fail" aria-label="failed">✗</span>
	{:else}
		<span class="pend" aria-label="pending">○</span>
	{/if}
	<b>{check.label}</b>
	{#if check.level !== undefined && check.state === 'ok'}
		<span class="meter"><i style="width: {check.level}%"></i></span>
	{/if}
	<small>{check.detail}</small>
	{#if check.fix && check.state === 'fail'}
		<code class="fix">{check.fix}</code>
	{/if}
</div>

<style>
	.dev {
		display: grid;
		grid-template-columns: 22px 1fr;
		gap: 2px 8px;
		align-items: center;
	}
	.dev b {
		font-size: 14px;
	}
	.dev small,
	.dev .meter,
	.dev .fix {
		grid-column: 2;
	}
	.dev small {
		color: var(--muted);
		font-size: 12px;
	}
	.fix {
		font: 11px ui-monospace, monospace;
		background: var(--bg);
		color: var(--bad);
		padding: 6px;
		border-radius: 4px;
		word-break: break-all;
		user-select: all;
	}
	.meter {
		display: inline-block;
		width: 100%;
		height: 6px;
		background: var(--line);
		border-radius: 3px;
		overflow: hidden;
	}
	.meter i {
		display: block;
		height: 100%;
		background: var(--good);
		transition: width 0.08s;
	}
	.ok {
		color: var(--good);
	}
	.fail {
		color: var(--bad);
	}
	.pend {
		color: var(--muted);
	}
</style>
