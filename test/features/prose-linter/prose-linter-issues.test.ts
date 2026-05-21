/**
 * @file ProseLinterIssues Test Suite
 */

import { analyzeWriting, hashContent } from '../../../src/core/writing-analysis';
import { buildProseIssues } from '../../../src/features/prose-linter/prose-linter-issues';
import { GENERAL_PROSE_CONFIG, type ProseIssue } from '../../../src/features/prose-linter/prose-linter-types';

describe('buildProseIssues', () => {
	test('converts writing analysis and deep issues into sorted prose issues with stable IDs', () => {
		const content = [
			'The plan was approved carefully.',
			'This sentence contains enough simple words to cross the configured long sentence threshold today.',
			'This sentence contains enough simple words to cross the configured very long sentence threshold today and it keeps going.',
			'This is very direct.'
		].join('\n');
		const analysis = analyzeWriting(content, { longSentenceThreshold: 10, veryLongSentenceThreshold: 16 });
		const deepIssue: ProseIssue = {
			id: 'deep',
			type: 'complex-word',
			ignoreKey: 'complex-word:0:test',
			severity: 'suggestion',
			line: 0,
			startCh: 0,
			endCh: 4,
			excerpt: 'The plan was approved carefully.',
			sourceText: 'plan',
			explanation: 'Test',
			suggestion: 'Test'
		};

		const issues = buildProseIssues({
			analysis,
			content,
			filePath: 'note.md',
			deepIssues: [deepIssue],
			config: {
				...GENERAL_PROSE_CONFIG,
				enabledIssueTypes: new Set([...GENERAL_PROSE_CONFIG.enabledIssueTypes, 'complex-word'])
			}
		});

		expect(issues.map((issue) => issue.type)).toEqual([
			'very-long-sentence',
			'passive-voice',
			'complex-word',
			'adverb',
			'weak-intensifier',
			'weak-intensifier',
			'long-sentence'
		]);
		const passive = issues.find((issue) => issue.type === 'passive-voice');
		expect(passive?.id).toBe(`note.md:passive-voice:0:9:21:${hashContent('was approved')}`);
		expect(passive?.explanation).toContain('Passive voice');
		expect(issues.find((issue) => issue.type === 'weak-intensifier')?.replacement).toEqual({
			source: 'very',
			replacement: ''
		});
		expect(issues.find((issue) => issue.type === 'weak-intensifier')?.suggestion).toBe('Remove it if the sentence still works, or choose a more exact word nearby.');
	});

	test('filters ignored issue IDs, persistent issue keys, and note-specific ignored issue types', () => {
		const content = 'The plan was approved carefully. This is very direct.';
		const analysis = analyzeWriting(content);
		const allIssues = buildProseIssues({ analysis, content, filePath: 'note.md' });
		const passiveId = allIssues.find((issue) => issue.type === 'passive-voice')?.id;
		const adverbKey = allIssues.find((issue) => issue.type === 'adverb')?.ignoreKey;

		const filtered = buildProseIssues({
			analysis,
			content,
			filePath: 'note.md',
			ignoredIssueIds: new Set(passiveId ? [passiveId] : []),
			ignoredIssueKeys: new Set(adverbKey ? [adverbKey] : []),
			ignoredIssueTypes: new Set(['weak-intensifier'])
		});

		expect(filtered).toEqual([]);
	});
});
