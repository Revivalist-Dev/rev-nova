/**
 * @file ProseLinterRunner - Budgeted deep-rule execution for the prose linter
 */

import type { AnalysisRunToken } from '../../core/writing-analysis-runner';
import { measureElapsedMs } from '../../core/writing-analysis-runner';
import { runProseLinterRules, type ProseRuleContext } from './prose-linter-rules';
import type { ProseIssue, ProseLinterConfig } from './prose-linter-types';

export type ProseLinterRunnerState = 'complete' | 'pending' | 'stale';

export interface ProseRuleDefinition {
	id: string;
	run: (context: ProseRuleContext) => ProseIssue[];
}

export interface RunProseLinterInput {
	content: string;
	config: ProseLinterConfig;
	filePath: string | null;
	runToken: AnalysisRunToken;
	budgetMs?: number;
	rules?: ProseRuleDefinition[];
	now?: () => number;
	isStale?: (token: AnalysisRunToken) => boolean;
}

export interface RunProseLinterResult {
	issues: ProseIssue[];
	elapsedMs: number;
	state: ProseLinterRunnerState;
	deferredRuleIds: string[];
	runToken: AnalysisRunToken;
}

const DEFAULT_BUDGET_MS = 24;

export function runBudgetedProseLinter(input: RunProseLinterInput): RunProseLinterResult {
	const now = input.now ?? (() => performance.now());
	const start = now();
	const budgetMs = input.budgetMs ?? DEFAULT_BUDGET_MS;
	const rules = input.rules ?? [{
		id: 'local-prose-rules',
		run: (context: ProseRuleContext) => runProseLinterRules(context).issues
	}];
	const context: ProseRuleContext = {
		content: input.content,
		config: input.config,
		filePath: input.filePath
	};
	const issues: ProseIssue[] = [];
	const deferredRuleIds: string[] = [];

	for (let index = 0; index < rules.length; index++) {
		if (input.isStale?.(input.runToken)) {
			return {
				issues: [],
				elapsedMs: measureElapsedMs(start, now()),
				state: 'stale',
				deferredRuleIds: rules.slice(index).map((rule) => rule.id),
				runToken: input.runToken
			};
		}

		const elapsedBeforeRule = measureElapsedMs(start, now());
		if (index > 0 && elapsedBeforeRule >= budgetMs) {
			deferredRuleIds.push(...rules.slice(index).map((rule) => rule.id));
			break;
		}

		issues.push(...rules[index].run(context));
	}

	return {
		issues,
		elapsedMs: measureElapsedMs(start, now()),
		state: deferredRuleIds.length > 0 ? 'pending' : 'complete',
		deferredRuleIds,
		runToken: input.runToken
	};
}
