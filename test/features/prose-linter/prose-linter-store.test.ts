/**
 * @file ProseLinterStore Test Suite
 */

import { ProseLinterStore, type ProseLinterStoreData } from '../../../src/features/prose-linter/prose-linter-store';
import type { ProseIssue } from '../../../src/features/prose-linter/prose-linter-types';

describe('ProseLinterStore', () => {
	const issue: ProseIssue = {
		id: 'note.md:weak-intensifier:0:8:12:test',
		ignoreKey: 'weak-intensifier:0:test',
		type: 'weak-intensifier',
		severity: 'suggestion',
		line: 0,
		startCh: 8,
		endCh: 12,
		excerpt: 'This is very useful.',
		sourceText: 'very',
		explanation: 'This weakener adds emphasis without making the sentence more precise.',
		suggestion: 'Remove it if the sentence still works, or choose a more exact word nearby.',
		replacement: { source: 'very', replacement: '' }
	};

	test('persists only note paths, issue fingerprints, issue types, and metadata', async () => {
		let saved: ProseLinterStoreData | null = null;
		const store = new ProseLinterStore({
			loadData: async () => null,
			saveData: async (data) => {
				saved = data;
			},
			now: () => 123
		});

		await store.ignoreIssue('note.md', issue);

		expect(saved).toEqual({
			version: 2,
			notes: {
				'note.md': {
					ignoredIssues: [{
						key: 'weak-intensifier:0:test',
						issueId: 'note.md:weak-intensifier:0:8:12:test',
						issueType: 'weak-intensifier',
						sourceHash: 'test',
						label: 'Weak intensifier',
						line: 0,
						ignoredAt: 123
					}],
					ignoredIssueTypes: [],
					updatedAt: 123
				}
			}
		});
		expect(JSON.stringify(saved)).not.toContain('This is very useful');
		expect(JSON.stringify(saved)).not.toContain('replacement');
		expect(JSON.stringify(saved)).not.toContain('content');
		expect(JSON.stringify(saved)).not.toContain('very');
	});

	test('migrates existing type ignores and can restore a type', async () => {
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
		expect(store.getDataForTests().version).toBe(2);

		await store.restoreIssueType('note.md', 'adverb');

		expect(saved?.notes['note.md'].ignoredIssueTypes).toEqual(['passive-voice']);
		expect(saved?.notes['note.md'].updatedAt).toBe(456);
	});

	test('loads existing individual ignores and can restore one issue', async () => {
		let saved: ProseLinterStoreData | null = null;
		const store = new ProseLinterStore({
			loadData: async () => ({
				version: 2,
				notes: {
					'note.md': {
						ignoredIssues: [{
							key: 'weak-intensifier:0:test',
							issueId: 'note.md:weak-intensifier:0:8:12:test',
							issueType: 'weak-intensifier',
							sourceHash: 'test',
							label: 'Weak intensifier',
							line: 0,
							ignoredAt: 10
						}],
						ignoredIssueTypes: [],
						updatedAt: 10
					}
				}
			}),
			saveData: async (data) => {
				saved = data;
			},
			now: () => 20
		});

		await store.load();
		expect(store.getIgnoredIssueKeys('note.md').has('weak-intensifier:0:test')).toBe(true);

		await store.restoreIssue('note.md', 'weak-intensifier:0:test');

		expect(saved?.notes['note.md'].ignoredIssues).toEqual([]);
		expect(saved?.notes['note.md'].updatedAt).toBe(20);
	});

	test('matches a persistent issue after nearby edits shift the line', async () => {
		const store = new ProseLinterStore({
			loadData: async () => null,
			saveData: async () => undefined,
			now: () => 10
		});
		await store.ignoreIssue('note.md', issue);

		const shiftedIssue: ProseIssue = {
			...issue,
			id: 'note.md:weak-intensifier:1:8:12:test',
			ignoreKey: 'weak-intensifier:1:test',
			line: 1
		};

		expect(store.getIgnoredIssueKeys('note.md', [shiftedIssue]).has('weak-intensifier:1:test')).toBe(true);
	});
});
