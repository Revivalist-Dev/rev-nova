import { DeepSeekProvider } from '../../../src/ai/providers/deepseek';
import { ProviderConfig } from '../../../src/ai/types';
import { TimeoutManager } from '../../../src/utils/timeout-manager';

// Mock Obsidian's requestUrl
jest.mock('obsidian', () => ({
    requestUrl: jest.fn()
}));

import { requestUrl } from 'obsidian';

describe('DeepSeekProvider', () => {
    let provider: DeepSeekProvider;
    let config: ProviderConfig;
    let timeoutManager: TimeoutManager;
    const generalSettings = {
        defaultTemperature: 0.7,
        defaultMaxTokens: 4000
    };

    beforeEach(() => {
        config = {
            apiKey: 'sk-test-deepseek-key',
            baseUrl: 'https://api.deepseek.com'
        };
        timeoutManager = new TimeoutManager();
        provider = new DeepSeekProvider(config, generalSettings, timeoutManager);
        jest.clearAllMocks();
    });

    describe('name', () => {
        test('should return DeepSeek as provider name', () => {
            expect(provider.name).toBe('DeepSeek');
        });
    });

    describe('isAvailable', () => {
        test('should return true when API key is configured', () => {
            expect(provider.isAvailable()).toBe(true);
        });

        test('should return false when API key is empty', () => {
            const noKeyProvider = new DeepSeekProvider(
                { apiKey: '' },
                generalSettings,
                timeoutManager
            );
            expect(noKeyProvider.isAvailable()).toBe(false);
        });

        test('should return false when API key is undefined', () => {
            const noKeyProvider = new DeepSeekProvider(
                {},
                generalSettings,
                timeoutManager
            );
            expect(noKeyProvider.isAvailable()).toBe(false);
        });
    });

    describe('updateConfig', () => {
        test('should update configuration and clear model cache', () => {
            provider.clearModelCache();
            const newConfig: ProviderConfig = {
                apiKey: 'sk-new-key',
                baseUrl: 'https://api.deepseek.com'
            };
            provider.updateConfig(newConfig);
            expect(provider.isAvailable()).toBe(true);
        });
    });

    describe('generateText', () => {
        test('should call chat completions endpoint and return text', async () => {
            const mockResponse = {
                status: 200,
                json: {
                    choices: [{
                        message: { role: 'assistant', content: 'Hello from DeepSeek!' }
                    }]
                }
            };

            (requestUrl as jest.Mock).mockResolvedValue(mockResponse);

            const result = await provider.generateText('Hi there');

            expect(result).toBe('Hello from DeepSeek!');
            const callArgs = (requestUrl as jest.Mock).mock.calls[0][0];
            expect(callArgs.url).toBe('https://api.deepseek.com/chat/completions');
            expect(callArgs.method).toBe('POST');
            expect(callArgs.headers.Authorization).toBe('Bearer sk-test-deepseek-key');

            const body = JSON.parse(callArgs.body);
            expect(body.model).toBe('deepseek-v4-flash');
            expect(body.messages).toEqual([{ role: 'user', content: 'Hi there' }]);
            expect(body.stream).toBe(false);
        });

        test('should use configured model when specified', async () => {
            const modelProvider = new DeepSeekProvider(
                { apiKey: 'sk-test', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' },
                generalSettings,
                timeoutManager
            );

            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: {
                    choices: [{ message: { content: 'Response' } }]
                }
            });

            await modelProvider.generateText('Hello');

            const body = JSON.parse((requestUrl as jest.Mock).mock.calls[0][0].body);
            expect(body.model).toBe('deepseek-v4-pro');
        });

        test('should include system prompt when provided', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: {
                    choices: [{ message: { content: 'Response' } }]
                }
            });

            await provider.generateText('Hello', {
                systemPrompt: 'You are a helpful assistant.'
            });

            const body = JSON.parse((requestUrl as jest.Mock).mock.calls[0][0].body);
            expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
            expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
        });

        test('should throw error when API key is not configured', async () => {
            const noKeyProvider = new DeepSeekProvider({}, generalSettings, timeoutManager);
            await expect(noKeyProvider.generateText('Hello')).rejects.toThrow('DeepSeek API key not configured');
        });

        test('should throw error on non-200 response', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 401,
                text: 'Unauthorized',
                json: { error: { message: 'Invalid API key' } }
            });

            await expect(provider.generateText('Hello')).rejects.toThrow('DeepSeek API error');
        });

        test('should throw error on unexpected response format', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: { unexpected: 'format' }
            });

            await expect(provider.generateText('Hello')).rejects.toThrow('Unexpected response format');
        });
    });

    describe('complete', () => {
        test('should send system and user messages', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: {
                    choices: [{ message: { content: 'Completed response' } }]
                }
            });

            const result = await provider.complete('System instruction', 'User message');

            expect(result).toBe('Completed response');
            const body = JSON.parse((requestUrl as jest.Mock).mock.calls[0][0].body);
            expect(body.messages).toEqual([
                { role: 'system', content: 'System instruction' },
                { role: 'user', content: 'User message' }
            ]);
        });
    });

    describe('generateTextStream', () => {
        test('should yield chunks and final done signal', async () => {
            const responseText = 'Streaming response from DeepSeek';
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: {
                    choices: [{ message: { content: responseText } }]
                }
            });

            const chunks: string[] = [];
            for await (const chunk of provider.generateTextStream('Hello')) {
                chunks.push(chunk.content);
                if (chunk.done) break;
            }

            const fullText = chunks.join('');
            expect(fullText).toBe(responseText);
        });

        test('should stop streaming when aborted', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: {
                    choices: [{ message: { content: 'A long streaming response' } }]
                }
            });

            const controller = new AbortController();
            // Abort immediately
            controller.abort();

            const results: { content: string; done: boolean }[] = [];
            for await (const chunk of provider.generateTextStream('Hello', { signal: controller.signal })) {
                results.push(chunk);
            }

            // Should exit early without yielding anything
            expect(results.length).toBe(0);
        });
    });

    describe('chatCompletionStream', () => {
        test('should yield chunks from chat messages', async () => {
            const responseText = 'Chat completion stream';
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: {
                    choices: [{ message: { content: responseText } }]
                }
            });

            const chunks: string[] = [];
            const messages = [{ role: 'user' as const, content: 'Chat message' }];
            for await (const chunk of provider.chatCompletionStream(messages)) {
                chunks.push(chunk.content);
                if (chunk.done) break;
            }

            expect(chunks.join('')).toBe(responseText);
        });
    });

    describe('getAvailableModels', () => {
        test('should return known DeepSeek models', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: { data: [] }
            });

            const models = await provider.getAvailableModels();

            expect(models).toContain('deepseek-v4-pro');
            expect(models).toContain('deepseek-v4-flash');
            expect(models).toContain('deepseek-chat');
            expect(models).toContain('deepseek-reasoner');
        });

        test('should return cached models on subsequent calls', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: { data: [] }
            });

            await provider.getAvailableModels();
            const models = await provider.getAvailableModels();

            // Should only have called API once (cached)
            expect(requestUrl).toHaveBeenCalledTimes(1);
            expect(models).toContain('deepseek-v4-pro');
        });

        test('should throw error when API key is not configured', async () => {
            const noKeyProvider = new DeepSeekProvider({}, generalSettings, timeoutManager);
            await expect(noKeyProvider.getAvailableModels()).rejects.toThrow('API key not configured');
        });
    });

    describe('clearModelCache', () => {
        test('should clear cached models', async () => {
            (requestUrl as jest.Mock).mockResolvedValue({
                status: 200,
                json: { data: [] }
            });

            await provider.getAvailableModels();
            provider.clearModelCache();
            await provider.getAvailableModels();

            // Should have called API twice (cache cleared)
            expect(requestUrl).toHaveBeenCalledTimes(2);
        });
    });
});
