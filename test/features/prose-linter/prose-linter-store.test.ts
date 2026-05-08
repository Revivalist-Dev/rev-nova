/**
 * @file ProseLinterStore Test Suite
 */

import { ProseLinterStore, type ProseLinterStoreData } from '../../../src/features/prose-linter/prose-linter-store';

describe('ProseLinterStore', () => {
	test('persists only note paths, issue types, and metadata', async () => {
		let saved: ProseLinterStoreData | null = null;
		const store = new ProseLinterStore({
			loadData: async () => null,
			saveData: async (data) => {
				saved = data;
			},
			now: () => 123
		});

		await store.ignoreIssueType('note.md', 'passive-voice');

		expect(saved).toEqual({
			version: 1,
			notes: {
				'note.md': {
					ignoredIssueTypes: ['passive-voice'],
					updatedAt: 123
				}
			}
		});
		expect(JSON.stringify(saved)).not.toContain('excerpt');
		expect(JSON.stringify(saved)).not.toContain('replacement');
		expect(JSON.stringify(saved)).not.toContain('content');
	});

	test('loads existing ignores and can restore a type', async () => {
		let saved: ProseLinterStoreData | null = null;
		const store = new ProseLinterStore({
			loadData: async () => ({
				version: 1,
				notes: {
					'note.md': {
						ignoredIssueTypes: ['adverb', 'passive-voice'],
						updatedAt: 1
					}
				}
			}),
			saveData: async (data) => {
				saved = data;
			},
			now: () => 456
		});

		await store.load();
		expect(store.isIssueTypeIgnored('note.md', 'adverb')).toBe(true);

		await store.restoreIssueType('note.md', 'adverb');

		expect(saved?.notes['note.md'].ignoredIssueTypes).toEqual(['passive-voice']);
		expect(saved?.notes['note.md'].updatedAt).toBe(456);
	});
});
