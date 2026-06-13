import { App, Platform } from 'obsidian';
import { AIProviderManager } from '../src/ai/provider-manager';
import { DEFAULT_SETTINGS, NovaSettingTab, NovaSettings } from '../src/settings';

interface MockPlatform {
	isMobile: boolean;
}

function cloneSettings(): NovaSettings {
	return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as NovaSettings;
}

describe('OpenAI-compatible settings', () => {
	beforeEach(() => {
		(Platform as unknown as MockPlatform).isMobile = false;
	});

	it('activates OpenAI-compatible when a discovered model is selected from settings', async () => {
		const settings = cloneSettings();
		settings.aiProviders['openai-compatible'] = {
			baseUrl: 'http://127.0.0.1:1234/v1',
			model: '',
			models: ['google/gemma-4-26b-a4b-it@iq4_xs'],
			modelsLastRefreshed: '2026-06-13T16:31:25.000Z',
			contextSize: 32000,
			status: {
				state: 'connected',
				message: 'Connected'
			}
		};
		settings.platformSettings.desktop = {
			selectedModel: 'none',
			selectedProvider: 'none'
		};

		const app = new App();
		const aiProviderManager = new AIProviderManager(settings);
		const plugin = {
			app,
			settings,
			aiProviderManager,
			saveSettings: jest.fn().mockResolvedValue(undefined),
			registerDomEvent: jest.fn((element: EventTarget, event: string, handler: EventListener) => {
				element.addEventListener(event, handler);
			})
		};
		const tab = new NovaSettingTab(app, plugin as never);
		const container = document.createElement('div');

		(tab as unknown as { createOpenAICompatibleModelSetting(container: HTMLElement): void })
			.createOpenAICompatibleModelSetting(container);

		const select = container.querySelector('select');
		expect(select).not.toBeNull();

		select!.value = 'google/gemma-4-26b-a4b-it@iq4_xs';
		select!.dispatchEvent(new Event('change'));
		await Promise.resolve();

		expect(settings.aiProviders['openai-compatible'].model).toBe('google/gemma-4-26b-a4b-it@iq4_xs');
		expect(settings.platformSettings.desktop).toEqual({
			selectedModel: 'google/gemma-4-26b-a4b-it@iq4_xs',
			selectedProvider: 'openai-compatible'
		});
		expect(plugin.saveSettings).toHaveBeenCalled();
		await expect(aiProviderManager.getCurrentProviderType()).resolves.toBe('openai-compatible');
	});
});
