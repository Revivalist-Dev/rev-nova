/**
 * @file ProseLinterIssues - Converts writing analysis output into prose linter issues
 */

import type { WritingAnalysis } from '../../core/writing-analysis';
import {
	GENERAL_PROSE_CONFIG,
	PROSE_ISSUE_PRIORITY,
	createProseIssueId,
	isProseIssueTypeEnabled,
	type ProseIssue,
	type ProseIssueSeverity,
	type ProseIssueType,
	type ProseLinterConfig
} from './prose-linter-types';

export interface BuildProseIssuesInput {
	analysis: WritingAnalysis;
	content: string;
	filePath: string | null;
	config?: ProseLinterConfig;
	deepIssues?: ProseIssue[];
	ignoredIssueIds?: ReadonlySet<string>;
	ignoredIssueTypes?: ReadonlySet<ProseIssueType>;
}

export function buildProseIssues(input: BuildProseIssuesInput): ProseIssue[] {
	const config = input.config ?? GENERAL_PROSE_CONFIG;
	const ignoredIssueIds = input.ignoredIssueIds ?? new Set<string>();
	const ignoredIssueTypes = input.ignoredIssueTypes ?? new Set<ProseIssueType>();
	const lines = input.content.split('\n');
	const issues: ProseIssue[] = [];

	for (const sentence of input.analysis.sentences) {
		if (sentence.severity === 'ok') {
			continue;
		}
		const type: ProseIssueType = sentence.severity === 'very-long' ? 'very-long-sentence' : 'long-sentence';
		if (!isProseIssueTypeEnabled(config, type)) {
			continue;
		}
		const sourceText = extractSourceText(lines, sentence.line, sentence.startCh, sentence.endCh);
		issues.push(createIssue({
			filePath: input.filePath,
			type,
			severity: sentence.severity === 'very-long' ? 'critical' : 'warning',
			line: sentence.line,
			startCh: sentence.startCh,
			endCh: sentence.endCh,
			sourceText,
			excerpt: extractExcerpt(lines, sentence.line),
			explanation: `This sentence has ${sentence.wordCount} words. Try splitting one idea into its own sentence.`,
			suggestion: 'Split the sentence or move a supporting clause into a shorter follow-up sentence.'
		}));
	}

	for (const match of input.analysis.passiveVoice) {
		if (!isProseIssueTypeEnabled(config, 'passive-voice')) {
			continue;
		}
		const sourceText = extractSourceText(lines, match.line, match.startCh, match.endCh);
		issues.push(createIssue({
			filePath: input.filePath,
			type: 'passive-voice',
			severity: 'warning',
			line: match.line,
			startCh: match.startCh,
			endCh: match.endCh,
			sourceText,
			excerpt: extractExcerpt(lines, match.line),
			explanation: 'Passive voice can hide the actor. Consider rewriting in active voice.',
			suggestion: 'Name the actor and make the verb direct.'
		}));
	}

	for (const match of input.analysis.adverbs) {
		if (!isProseIssueTypeEnabled(config, 'adverb')) {
			continue;
		}
		const sourceText = extractSourceText(lines, match.line, match.startCh, match.endCh);
		issues.push(createIssue({
			filePath: input.filePath,
			type: 'adverb',
			severity: 'suggestion',
			line: match.line,
			startCh: match.startCh,
			endCh: match.endCh,
			sourceText,
			excerpt: extractExcerpt(lines, match.line),
			explanation: 'This adverb may be doing work a stronger verb could do.',
			suggestion: 'Use a sharper verb or remove the adverb if the sentence still holds.'
		}));
	}

	for (const match of input.analysis.weakIntensifiers) {
		if (!isProseIssueTypeEnabled(config, 'weak-intensifier')) {
			continue;
		}
		const sourceText = extractSourceText(lines, match.line, match.startCh, match.endCh);
		issues.push(createIssue({
			filePath: input.filePath,
			type: 'weak-intensifier',
			severity: 'suggestion',
			line: match.line,
			startCh: match.startCh,
			endCh: match.endCh,
			sourceText,
			excerpt: extractExcerpt(lines, match.line),
			explanation: 'This intensifier often weakens the sentence.',
			suggestion: 'Remove it or replace the surrounding phrase with a more exact word.',
			replacement: { source: sourceText, replacement: '' }
		}));
	}

	issues.push(...(input.deepIssues ?? []).filter((issue) => isProseIssueTypeEnabled(config, issue.type)));

	const unique = new Map<string, ProseIssue>();
	for (const issue of issues) {
		if (ignoredIssueIds.has(issue.id) || ignoredIssueTypes.has(issue.type)) {
			continue;
		}
		unique.set(issue.id, issue);
	}

	return Array.from(unique.values()).sort(compareProseIssues);
}

export function compareProseIssues(left: ProseIssue, right: ProseIssue): number {
	const priority = PROSE_ISSUE_PRIORITY[left.type] - PROSE_ISSUE_PRIORITY[right.type];
	if (priority !== 0) {
		return priority;
	}
	if (left.line !== right.line) {
		return left.line - right.line;
	}
	return left.startCh - right.startCh;
}

interface CreateIssueInput {
	filePath: string | null;
	type: ProseIssueType;
	severity: ProseIssueSeverity;
	line: number;
	startCh: number;
	endCh: number;
	sourceText: string;
	excerpt: string;
	explanation: string;
	suggestion: string;
	replacement?: ProseIssue['replacement'];
}

function createIssue(input: CreateIssueInput): ProseIssue {
	return {
		id: createProseIssueId(input.filePath, input.type, input.line, input.startCh, input.endCh, input.sourceText),
		type: input.type,
		severity: input.severity,
		line: input.line,
		startCh: input.startCh,
		endCh: input.endCh,
		excerpt: input.excerpt,
		sourceText: input.sourceText,
		explanation: input.explanation,
		suggestion: input.suggestion,
		replacement: input.replacement
	};
}

function extractSourceText(lines: string[], line: number, startCh: number, endCh: number): string {
	const lineText = lines[line] ?? '';
	return lineText.slice(
		Math.max(0, Math.min(startCh, lineText.length)),
		Math.max(0, Math.min(endCh, lineText.length))
	);
}

function extractExcerpt(lines: string[], line: number): string {
	return (lines[line] ?? '').trim();
}
