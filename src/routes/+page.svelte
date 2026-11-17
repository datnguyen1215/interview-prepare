<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Recorder from '#lib/Recorder.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let playing = $state<string | null>(null);

	const pad = (n: number) => String(n).padStart(2, '0');

	function formatDuration(s: number): string {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
	}

	function formatDate(ms: number): string {
		const d = new Date(ms);
		const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
		if (days === 0) return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
		if (days === 1) return 'Yesterday';
		return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head><title>Interview Recorder</title></svelte:head>

<main class="studio">
	<Recorder onsaved={invalidateAll} />

	<div class="lib">
		{#each data.recordings as r (r.name)}
			<article class="card">
				<div class="thumb">
					{#if playing === r.name}
						<video controls autoplay src="/recordings/{encodeURIComponent(r.name)}"></video>
					{:else}
						<video preload="metadata" muted src="/recordings/{encodeURIComponent(r.name)}#t=1"></video>
						<button aria-label="Play {r.title}" onclick={() => (playing = r.name)}>▶</button>
						{#if r.duration}
							<span class="dur">{formatDuration(r.duration)}</span>
						{/if}
					{/if}
				</div>
				<div class="meta">
					<div>
						<b>{r.title}</b>
						<small>{formatDate(r.created)} · {Math.max(1, Math.round(r.size / 1e6))} MB</small>
					</div>
					<form
						method="POST"
						action="?/delete"
						use:enhance={({ cancel }) => {
							if (!confirm(`Delete "${r.title}"?`)) cancel();
						}}
					>
						<input type="hidden" name="name" value={r.name} />
						<button class="icon-btn" aria-label="Delete {r.title}">🗑</button>
					</form>
				</div>
			</article>
		{/each}
	</div>
</main>

<style>
	:global(:root) {
		--bg: #0c0c0d;
		--panel: #16161a;
		--fg: #f4f4f5;
		--muted: #a1a1aa;
		--line: #27272a;
		--accent: #60a5fa;
		--good: #4ade80;
		--bad: #f87171;
	}
	:global(*) {
		box-sizing: border-box;
	}
	:global(html, body) {
		background: var(--bg);
		color: var(--fg);
		margin: 0;
		font-family: system-ui, sans-serif;
	}
	:global(:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.studio {
		max-width: 1100px;
		margin: 0 auto;
		padding: 20px 16px;
		display: grid;
		grid-template-columns: 1fr 280px;
		gap: 16px;
		align-items: start;
	}
	.lib {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}
	.card {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}
	.thumb {
		aspect-ratio: 16 / 9;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		position: relative;
		display: grid;
		place-items: center;
	}
	.thumb video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.thumb button {
		position: relative;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 0;
		background: rgba(244, 244, 245, 0.9);
		cursor: pointer;
	}
	.thumb button:hover {
		background: #fff;
	}
	.dur {
		position: absolute;
		right: 6px;
		bottom: 6px;
		font-size: 12px;
		background: rgba(0, 0, 0, 0.7);
		padding: 1px 5px;
		border-radius: 3px;
	}
	.meta {
		padding: 8px 10px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.meta div {
		min-width: 0;
	}
	.meta b {
		display: block;
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta small {
		color: var(--muted);
		font-size: 12px;
	}
	.icon-btn {
		min-width: 44px;
		min-height: 44px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.icon-btn:hover {
		color: var(--bad);
		border-color: var(--line);
	}
	@media (max-width: 760px) {
		.studio {
			grid-template-columns: 1fr;
		}
	}
</style>
