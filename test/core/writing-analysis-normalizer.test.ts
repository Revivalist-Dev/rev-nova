/**
 * @file WritingAnalysisNormalizer Test Suite
 */

import { normalizeMarkdownForWritingAnalysis } from '../../src/core/writing-analysis-normalizer';

describe('normalizeMarkdownForWritingAnalysis', () => {
	function expectPositionStable(content: string): void {
		const normalized = normalizeMarkdownForWritingAnalysis(content);
		const sourceLines = content.split('\n');

		expect(normalized.normalizedContent.length).toBe(content.length);
		expect(normalized.lines).toHaveLength(sourceLines.length);
		normalized.lines.forEach((line, index) => {
			expect(line.length).toBe(sourceLines[index].length);
		});
	}

	test('preserves line and character positions while masking Markdown structures', () => {
		const content = [
			'---',
			'title: Test',
			'nova-analysis: true',
			'---',
			'Visible sentence was written quickly.',
			'',
			'```ts',
			'const hidden = "really bad prose";',
			'```',
			'Use `really hidden` inline code.',
			'| Term | Meaning |',
			'| --- | --- |',
			'| utilize | use |',
			'Visit https://example.com/really-fast.',
			'Read [[Hidden Note]] and [visible label](https://example.com).',
			'#hidden-tag ^hidden-block',
			'> [!note]',
			'> really hidden callout',
			'<!-- nova: hidden fill marker -->'
		].join('\n');

		const normalized = normalizeMarkdownForWritingAnalysis(content);

		expectPositionStable(content);
		expect(normalized.normalizedContent).toContain('Visible sentence was written quickly.');
		expect(normalized.normalizedContent).toContain('visible label');
		expect(normalized.normalizedContent).not.toContain('really bad prose');
		expect(normalized.normalizedContent).not.toContain('really hidden');
		expect(normalized.normalizedContent).not.toContain('utilize');
		expect(normalized.normalizedContent).not.toContain('https://example.com');
		expect(normalized.normalizedContent).not.toContain('Hidden Note');
		expect(normalized.normalizedContent).not.toContain('#hidden-tag');
		expect(normalized.normalizedContent).not.toContain('^hidden-block');
		expect(normalized.normalizedContent).not.toContain('callout');
		expect(normalized.normalizedContent).not.toContain('fill marker');
	});

	test('detects frontmatter opt-out while preserving content length', () => {
		const content = [
			'---',
			'nova-analysis: off',
			'---',
			'This text should not be analyzed.'
		].join('\n');

		const normalized = normalizeMarkdownForWritingAnalysis(content);

		expect(normalized.optOut).toBe(true);
		expect(normalized.normalizedContent.length).toBe(content.length);
		expect(normalized.normalizedContent.trim()).toBe('This text should not be analyzed.');
	});

	test('can keep blockquote content for core metrics while flagging quote lines', () => {
		const content = '> The report was really written by the team carefully.';

		const normalized = normalizeMarkdownForWritingAnalysis(content);

		expect(normalized.quoteLineFlags).toEqual([true]);
		expect(normalized.normalizedContent).toContain('The report was really written');
		expect(normalized.normalizedContent.startsWith('  ')).toBe(true);
	});

	test('can mask blockquote content for deep linter rules', () => {
		const content = '> The report was really written by the team carefully.';

		const normalized = normalizeMarkdownForWritingAnalysis(content, { maskBlockquoteContent: true });

		expect(normalized.quoteLineFlags).toEqual([true]);
		expect(normalized.normalizedContent.trim()).toBe('');
		expect(normalized.normalizedContent.length).toBe(content.length);
	});

	test('handles long repeated marker-like input without runaway time', () => {
		const content = `${'`not closed '.repeat(5000)} visible text.`;
		const start = performance.now();

		const normalized = normalizeMarkdownForWritingAnalysis(content);

		expect(performance.now() - start).toBeLessThan(100);
		expect(normalized.normalizedContent).toContain('visible text');
	});
});
