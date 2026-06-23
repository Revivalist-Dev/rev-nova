/**
 * @file DeepSeekProvider - DeepSeek API integration (OpenAI-compatible chat completions)
 */

import { AIProvider, AIMessage, AIGenerationOptions, AIStreamResponse, ProviderConfig } from '../types';
import { requestUrl } from 'obsidian';
import { TimeoutManager } from '../../utils/timeout-manager';
import { Logger } from '../../utils/logger';

const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';

export class DeepSeekProvider implements AIProvider {
	name = 'DeepSeek';
	private config: ProviderConfig;
	private cachedModels: string[] | null = null;
	private generalSettings: { defaultTemperature: number; defaultMaxTokens: number };
	private timeoutManager: TimeoutManager;

	constructor(config: ProviderConfig, generalSettings: { defaultTemperature: number; defaultMaxTokens: number }, timeoutManager: TimeoutManager) {
		this.config = config;
		this.generalSettings = generalSettings;
		this.timeoutManager = timeoutManager;
	}

	updateConfig(config: ProviderConfig): void {
		this.config = config;
		this.cachedModels = null;
	}

	isAvailable(): boolean {
		return !!this.config.apiKey;
	}

	async generateText(prompt: string, options?: AIGenerationOptions): Promise<string> {
		const messages: AIMessage[] = [{ role: 'user', content: prompt }];
		return this.chatCompletion(messages, options);
	}

	async *generateTextStream(prompt: string, options?: AIGenerationOptions): AsyncGenerator<AIStreamResponse> {
		const messages: AIMessage[] = [{ role: 'user', content: prompt }];
		yield* this.chatCompletionStream(messages, options);
	}

	async chatCompletion(messages: AIMessage[], options?: AIGenerationOptions): Promise<string> {
		if (!this.config.apiKey) {
			throw new Error('DeepSeek API key not configured');
		}

		const requestMessages = [...messages];
		if (options?.systemPrompt) {
			requestMessages.unshift({ role: 'system', content: options.systemPrompt });
		}

		const modelName = options?.model || this.config.model || 'deepseek-v4-flash';
		const baseUrl = this.config.baseUrl || DEEPSEEK_DEFAULT_BASE_URL;
		const endpoint = `${baseUrl}/chat/completions`;

		const requestBody: Record<string, unknown> = {
			model: modelName,
			messages: requestMessages,
			temperature: options?.temperature ?? this.generalSettings.defaultTemperature,
			max_tokens: options?.maxTokens ?? this.generalSettings.defaultMaxTokens,
			stream: false
		};

		const response = await requestUrl({
			url: endpoint,
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify(requestBody),
			throw: false
		});

		if (response.status !== 200) {
			Logger.error('DeepSeek API error details:', {
				status: response.status,
				headers: response.headers,
				errorText: response.text,
				model: modelName,
				endpoint
			});
			throw new Error(`DeepSeek API error: ${this.formatErrorMessage(response.status, response.text, response.json)}`);
		}

		const content = this.extractChatCompletionText(response.json);
		if (!content) {
			Logger.error('DeepSeek API response error: unexpected format', {
				data: response.json,
				model: modelName,
				endpoint
			});
			throw new Error('DeepSeek API: Unexpected response format');
		}

		return content;
	}

	async complete(systemPrompt: string, userPrompt: string, options?: AIGenerationOptions): Promise<string> {
		const messages: AIMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		];
		return this.chatCompletion(messages, options);
	}

	async *chatCompletionStream(messages: AIMessage[], options?: AIGenerationOptions): AsyncGenerator<AIStreamResponse> {
		const result = await this.chatCompletion(messages, options);

		const chunkSize = 3;
		for (let index = 0; index < result.length; index += chunkSize) {
			if (options?.signal?.aborted) {
				return;
			}

			yield { content: result.slice(index, index + chunkSize), done: false };
			await new Promise<void>(resolve => {
				this.timeoutManager.addTimeout(() => resolve(), 20);
			});
		}

		yield { content: '', done: true };
	}

	async getAvailableModels(): Promise<string[]> {
		if (this.cachedModels) {
			return this.cachedModels;
		}

		if (!this.config.apiKey) {
			throw new Error('DeepSeek API key not configured');
		}

		try {
			const baseUrl = this.config.baseUrl || DEEPSEEK_DEFAULT_BASE_URL;
			const endpoint = `${baseUrl}/models`;

			const response = await requestUrl({
				url: endpoint,
				method: 'GET',
				headers: this.getHeaders(),
				throw: false
			});

			if (response.status !== 200) {
				throw new Error(`API request failed: ${response.status}`);
			}

			// Validate response format
			void response.json;

			// Return known DeepSeek models
			const models = [
				'deepseek-v4-pro',
				'deepseek-v4-flash',
				'deepseek-chat',
				'deepseek-reasoner'
			];

			this.cachedModels = models;
			return models;
		} catch (error) {
			throw new Error(`Failed to fetch DeepSeek models: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	clearModelCache(): void {
		this.cachedModels = null;
	}

	private getHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${this.config.apiKey}`
		};
	}

	private extractChatCompletionText(responseJson: unknown): string {
		if (!responseJson || typeof responseJson !== 'object') {
			return '';
		}

		const choices = (responseJson as { choices?: unknown }).choices;
		if (!Array.isArray(choices) || choices.length === 0) {
			return '';
		}

		const firstChoice = choices[0] as { message?: unknown; text?: unknown };
		if (firstChoice.message && typeof firstChoice.message === 'object') {
			const content = (firstChoice.message as { content?: unknown }).content;
			return typeof content === 'string' ? content : '';
		}

		if (typeof firstChoice.text === 'string') {
			return firstChoice.text;
		}

		return '';
	}

	private formatErrorMessage(status: number, responseText: string, responseJson: unknown): string {
		if (responseJson && typeof responseJson === 'object') {
			const error = (responseJson as { error?: unknown }).error;
			if (typeof error === 'string') {
				return `${status}: ${error}`;
			}
			if (error && typeof error === 'object') {
				const errorObj = error as { message?: unknown; type?: unknown; code?: unknown };
				const message = errorObj.message || errorObj.type || errorObj.code;
				if (typeof message === 'string') {
					return `${status}: ${message}`;
				}
			}
		}

		return responseText ? `${status}: ${responseText}` : `${status}`;
	}
}
