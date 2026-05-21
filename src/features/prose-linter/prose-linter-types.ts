/**
 * @file ProseLinterTypes - Shared types and General prose config for Nova's local prose linter
 */

import { hashContent } from '../../core/writing-analysis';

export type ProseIssueType =
	| 'long-sentence'
	| 'very-long-sentence'
	| 'passive-voice'
	| 'adverb'
	| 'weak-intensifier'
	| 'qualifier'
	| 'complex-word'
	| 'repeated-word'
	| 'repeated-phrase'
	| 'sticky-sentence'
	| 'sentence-start'
	| 'telling-language';

export type ProseIssueSeverity = 'info' | 'suggestion' | 'warning' | 'critical';

export interface ProseReplacement {
	source: string;
	replacement: string;
}

export interface ProseIssueRange {
	line: number;
	startCh: number;
	endCh: number;
}

export interface ProseIssue {
	id: string;
	ignoreKey: string;
	type: ProseIssueType;
	severity: ProseIssueSeverity;
	line: number;
	startCh: number;
	endCh: number;
	excerpt: string;
	sourceText: string;
	explanation: string;
	suggestion: string;
	replacement?: ProseReplacement;
	relatedRanges?: ProseIssueRange[];
}

export interface ProseLinterConfig {
	targetGrade: number;
	longSentenceWords: number;
	veryLongSentenceWords: number;
	enabledIssueTypes: ReadonlySet<ProseIssueType>;
}

export interface ProseIssueTypeIgnoreRecord {
	filePath: string;
	issueType: ProseIssueType;
	ignoredAt: number;
}

export const GENERAL_PROSE_CONFIG: ProseLinterConfig = {
	targetGrade: 8,
	longSentenceWords: 25,
	veryLongSentenceWords: 40,
	enabledIssueTypes: new Set([
		'very-long-sentence',
		'long-sentence',
		'passive-voice',
		'adverb',
		'weak-intensifier',
		'qualifier',
		'complex-word',
		'repeated-word',
		'repeated-phrase'
	])
};

export const PROSE_ISSUE_LABELS: Record<ProseIssueType, string> = {
	'long-sentence': 'Long sentence',
	'very-long-sentence': 'Very long sentence',
	'passive-voice': 'Passive voice',
	adverb: 'Adverb',
	'weak-intensifier': 'Weak intensifier',
	qualifier: 'Qualifier',
	'complex-word': 'Complex word',
	'repeated-word': 'Repeated word',
	'repeated-phrase': 'Repeated phrase',
	'sticky-sentence': 'Sticky sentence',
	'sentence-start': 'Repeated sentence start',
	'telling-language': 'Telling language'
};

export const PROSE_ISSUE_PRIORITY: Record<ProseIssueType, number> = {
	'very-long-sentence': 0,
	'sticky-sentence': 1,
	'repeated-phrase': 2,
	'passive-voice': 3,
	'complex-word': 4,
	adverb: 5,
	'weak-intensifier': 5,
	qualifier: 5,
	'repeated-word': 6,
	'sentence-start': 7,
	'long-sentence': 8,
	'telling-language': 9
};

export function isProseIssueTypeEnabled(config: ProseLinterConfig, type: ProseIssueType): boolean {
	return config.enabledIssueTypes.has(type);
}

export function createProseIssueId(
	filePath: string | null,
	type: ProseIssueType,
	line: number,
	startCh: number,
	endCh: number,
	sourceText: string
): string {
	const pathPart = filePath ?? 'active-note';
	return [
		pathPart,
		type,
		line,
		startCh,
		endCh,
		hashContent(sourceText)
	].join(':');
}

export function createProseIssueIgnoreKey(
	type: ProseIssueType,
	line: number,
	sourceText: string
): string {
	return [
		type,
		line,
		hashContent(normalizeIssueSource(sourceText))
	].join(':');
}

export function normalizeIssueSource(sourceText: string): string {
	return sourceText
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}
