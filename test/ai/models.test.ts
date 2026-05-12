import {
	getAvailableModels,
	getContextLimit,
	getModelMaxOutputTokens,
	getProviderTypeForModel
} from '../../src/ai/models';
import type { NovaSettings } from '../../src/settings';

function createSettingsWithOllama(ollama: NovaSettings['aiProviders']['ollama']): NovaSettings {
	return {
		aiProviders: {
			claude: {},
			openai: {},
			google: {},
			ollama
		},
		platformSettings: {
			desktop: { selectedModel: '' },
			mobile: { selectedModel: 'none' }
		},
		general: {
			defaultTemperature: 0.7,
			defaultMaxTokens: 4000,
			showReleaseNotes: true,
			lastSeenVersion: '',
			customPromptHistory: []
		},
		licensing: {
			supernovaLicenseKey: '',
			debugSettings: { enabled: false }
		},
		commands: {
			suggestionMode: 'balanced',
			responseTime: 'normal',
			hideWhileTyping: true,
			enabledDocumentTypes: []
		},
		writingAnalysis: {
			enabled: true,
			longSentenceThreshold: 25,
			veryLongSentenceThreshold: 35,
			showStatsPanel: true
		},
		dashboard: {
			excludeFolders: [],
			targetReadabilityGrade: 8
		}
	};
}

describe('AI model registry', () => {
	test('includes GPT-5.5 models in the OpenAI picker list', () => {
		const openaiModels = getAvailableModels('openai');

		expect(openaiModels.slice(0, 2)).toEqual([
			{ value: 'gpt-5.5-pro', label: 'GPT-5.5 Pro' },
			{ value: 'gpt-5.5', label: 'GPT-5.5' }
		]);
	});

	test('maps GPT-5.5 models to OpenAI context metadata', () => {
		expect(getProviderTypeForModel('gpt-5.5')).toBe('openai');
		expect(getProviderTypeForModel('gpt-5.5-pro')).toBe('openai');
		expect(getContextLimit('openai', 'gpt-5.5')).toBe(1050000);
		expect(getContextLimit('openai', 'gpt-5.5-pro')).toBe(1050000);
		expect(getModelMaxOutputTokens('openai', 'gpt-5.5')).toBe(128000);
		expect(getModelMaxOutputTokens('openai', 'gpt-5.5-pro')).toBe(128000);
	});

	test('returns cached Ollama models for the model picker', () => {
		const settings = createSettingsWithOllama({
			baseUrl: 'http://localhost:11434',
			model: 'llama3.1:8b',
			models: ['qwen3:14b', 'gemma3:12b'],
			modelsLastRefreshed: '2026-05-12T10:30:00.000Z'
		});

		expect(getAvailableModels('ollama', settings)).toEqual([
			{ value: 'qwen3:14b', label: 'qwen3:14b' },
			{ value: 'gemma3:12b', label: 'gemma3:12b' },
			{ value: 'llama3.1:8b', label: 'llama3.1:8b' }
		]);
		expect(getProviderTypeForModel('qwen3:14b', settings)).toBe('ollama');
	});

	test('keeps a legacy saved Ollama model when cache is empty', () => {
		const settings = createSettingsWithOllama({
			baseUrl: 'http://localhost:11434',
			model: 'llama3.1:8b',
			models: [],
			modelsLastRefreshed: null
		});

		expect(getAvailableModels('ollama', settings)).toEqual([
			{ value: 'llama3.1:8b', label: 'llama3.1:8b' }
		]);
	});
});
