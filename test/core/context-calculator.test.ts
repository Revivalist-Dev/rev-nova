import { calculateContextUsage } from '../../src/core/context-calculator';

describe('ContextCalculator', () => {
	test('uses configured context size for OpenAI-compatible providers', () => {
		const usage = calculateContextUsage(
			'openai-compatible',
			'custom-model',
			[{ content: 'conversation text' }],
			[],
			'current input',
			'',
			32000,
			64000
		);

		expect(usage.contextLimit).toBe(64000);
		expect(usage.totalTokens).toBeGreaterThan(0);
	});
});
