/**
 * @file WritingAnalysisRunner Test Suite
 */

import { createAnalysisRunToken, isStaleAnalysisRun, measureElapsedMs } from '../../src/core/writing-analysis-runner';

describe('writing-analysis-runner', () => {
	test('marks a previous run stale when the file path changes', () => {
		const first = createAnalysisRunToken('notes/old.md', 'abc123', 1);
		const current = createAnalysisRunToken('notes/new.md', 'def456', 2);

		expect(isStaleAnalysisRun(current, first)).toBe(true);
	});

	test('marks a previous run stale when the content hash changes', () => {
		const candidate = createAnalysisRunToken('notes/current.md', 'abc123', 2);
		const current = createAnalysisRunToken('notes/current.md', 'def456', 2);

		expect(isStaleAnalysisRun(current, candidate)).toBe(true);
	});

	test('marks a previous run stale when the sequence changes', () => {
		const candidate = createAnalysisRunToken('notes/current.md', 'abc123', 1);
		const current = createAnalysisRunToken('notes/current.md', 'abc123', 2);

		expect(isStaleAnalysisRun(current, candidate)).toBe(true);
	});

	test('accepts a candidate that still matches the current run', () => {
		const candidate = createAnalysisRunToken('notes/current.md', 'abc123', 4);
		const current = createAnalysisRunToken('notes/current.md', 'abc123', 4);

		expect(isStaleAnalysisRun(current, candidate)).toBe(false);
	});

	test('never returns negative elapsed time', () => {
		expect(measureElapsedMs(10, 5)).toBe(0);
		expect(measureElapsedMs(5, 12)).toBe(7);
	});
});
