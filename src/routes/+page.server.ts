import { error } from '@sveltejs/kit';
import { deleteRecording, listRecordings } from '#lib/server/recordings.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ recordings: listRecordings() });

export const actions: Actions = {
	delete: async ({ request }) => {
		const name = (await request.formData()).get('name');
		if (typeof name !== 'string') error(400, 'missing recording name');
		deleteRecording(name);
	}
};
