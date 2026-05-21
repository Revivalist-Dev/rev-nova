/**
 * @file ProseLinterRules Test Suite
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { analyzeWriting } from '../../../src/core/writing-analysis';
import { buildProseIssues } from '../../../src/features/prose-linter/prose-linter-issues';
import { runProseLinterRules } from '../../../src/features/prose-linter/prose-linter-rules';
import { GENERAL_PROSE_CONFIG } from '../../../src/features/prose-linter/prose-linter-types';

describe('runProseLinterRules', () => {
	test('detects qualifiers, complex words, repeated words, and repeated phrases', () => {
		const content = [
			'Maybe we should utilize numerous screenshots.',
			'The draft draft needs work.',
			'Clear launch story matters because clear launch story spreads fast.'
		].join('\n');

		const result = runProseLinterRules({
			content,
			filePath: 'launch.md',
			config: GENERAL_PROSE_CONFIG
		});

		expect(result.issues.map((issue) => issue.type)).toEqual([
			'qualifier',
			'complex-word',
			'complex-word',
			'repeated-word',
			'repeated-phrase'
		]);
		expect(result.issues.find((issue) => issue.type === 'repeated-phrase')).toMatchObject({
			sourceText: 'clear launch story',
			explanation: 'This phrase appears 2 times nearby.',
			relatedRanges: [
				{ line: 2, startCh: 0, endCh: 18 },
				{ line: 2, startCh: 35, endCh: 53 }
			]
		});
		expect(result.issues.find((issue) => issue.type === 'repeated-word')).toMatchObject({
			relatedRanges: [
				{ line: 1, startCh: 4, endCh: 9 },
				{ line: 1, startCh: 10, endCh: 15 }
			]
		});
		expect(result.issues.find((issue) => issue.type === 'complex-word')?.replacement).toEqual({
			source: 'utilize',
			replacement: 'use'
		});
		expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	test('ignores Markdown structures and keeps all must-ship launch categories available through the converter', () => {
		const fixture = readFileSync(join(process.cwd(), 'test/fixtures/prose-linter-launch-note.md'), 'utf8');
		const ruleResult = runProseLinterRules({
			content: fixture,
			filePath: 'fixture.md',
			config: GENERAL_PROSE_CONFIG
		});
		const analysis = analyzeWriting(fixture, {
			longSentenceThreshold: GENERAL_PROSE_CONFIG.longSentenceWords,
			veryLongSentenceThreshold: GENERAL_PROSE_CONFIG.veryLongSentenceWords
		});
		const issues = buildProseIssues({
			analysis,
			content: fixture,
			filePath: 'fixture.md',
			deepIssues: ruleResult.issues
		});
		const issueTypes = new Set(issues.map((issue) => issue.type));

		expect(issueTypes).toEqual(new Set([
			'very-long-sentence',
			'long-sentence',
			'passive-voice',
			'adverb',
			'weak-intensifier',
			'qualifier',
			'complex-word',
			'repeated-word',
			'repeated-phrase'
		]));
		expect(issues.some((issue) => issue.excerpt.includes('hidden callout'))).toBe(false);
		expect(issues.some((issue) => issue.excerpt.includes('hidden fill marker'))).toBe(false);
		expect(ruleResult.elapsedMs).toBeLessThan(100);
	});
});
