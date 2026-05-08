/**
 * @file ProseLinterTypes Test Suite
 */

import { GENERAL_PROSE_CONFIG, PROSE_ISSUE_LABELS, createProseIssueId } from '../../../src/features/prose-linter/prose-linter-types';

describe('prose-linter-types', () => {
	test('ships the General prose config without profiles or stretch report categories enabled', () => {
		expect(GENERAL_PROSE_CONFIG.targetGrade).toBe(8);
		expect(GENERAL_PROSE_CONFIG.longSentenceWords).toBe(25);
		expect(GENERAL_PROSE_CONFIG.veryLongSentenceWords).toBe(40);
		expect(Array.from(GENERAL_PROSE_CONFIG.enabledIssueTypes)).toEqual([
			'very-long-sentence',
			'long-sentence',
			'passive-voice',
			'adverb',
			'weak-intensifier',
			'qualifier',
			'complex-word',
			'repeated-word',
			'repeated-phrase'
		]);
		expect(GENERAL_PROSE_CONFIG.enabledIssueTypes.has('sticky-sentence')).toBe(false);
		expect(GENERAL_PROSE_CONFIG.enabledIssueTypes.has('sentence-start')).toBe(false);
		expect(GENERAL_PROSE_CONFIG.enabledIssueTypes.has('telling-language')).toBe(false);
		expect(Object.keys(PROSE_ISSUE_LABELS)).not.toContain('transition-usage');
		expect(Object.keys(PROSE_ISSUE_LABELS)).not.toContain('profile');
	});

	test('creates stable issue IDs from file path, issue type, range, and source hash', () => {
		const first = createProseIssueId('note.md', 'complex-word', 2, 4, 11, 'utilize');
		const second = createProseIssueId('note.md', 'complex-word', 2, 4, 11, 'utilize');
		const third = createProseIssueId('note.md', 'complex-word', 2, 4, 11, 'facilitate');

		expect(first).toBe(second);
		expect(first).not.toBe(third);
		expect(first).toContain('note.md:complex-word:2:4:11:');
	});
});
