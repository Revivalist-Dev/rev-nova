/**
 * @file ProseLinterRules - Deterministic local prose rules for the prose linter
 */

import { indexToPosition, normalizeMarkdownForWritingAnalysis } from '../../core/writing-analysis-normalizer';
import { measureElapsedMs } from '../../core/writing-analysis-runner';
import {
	createProseIssueId,
	createProseIssueIgnoreKey,
	isProseIssueTypeEnabled,
	type ProseIssue,
	type ProseIssueRange,
	type ProseIssueSeverity,
	type ProseIssueType,
	type ProseLinterConfig
} from './prose-linter-types';

export interface ProseRuleContext {
	content: string;
	config: ProseLinterConfig;
	filePath: string | null;
}

export interface ProseRuleResult {
	issues: ProseIssue[];
	elapsedMs: number;
}

interface WordToken {
	word: string;
	lower: string;
	startIndex: number;
	endIndex: number;
	line: number;
	startCh: number;
	endCh: number;
}

const COMPLEX_WORD_REPLACEMENTS: Record<string, string> = {
	utilize: 'use',
	approximately: 'about',
	assistance: 'help',
	numerous: 'many',
	facilitate: 'help',
	commence: 'start',
	demonstrate: 'show'
};

const QUALIFIER_PHRASES = [
	'i think',
	'i believe',
	'it seems',
	'sort of',
	'kind of',
	'maybe',
	'perhaps',
	'possibly'
];

const STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'but',
	'by',
	'for',
	'from',
	'in',
	'is',
	'it',
	'of',
	'on',
	'or',
	'that',
	'the',
	'this',
	'to',
	'was',
	'were',
	'with'
]);

const MIN_REPEATED_PHRASE_WORDS = 2;
const MAX_REPEATED_PHRASE_WORDS = 4;
const REPEATED_PHRASE_WINDOW_CHARS = 600;

const wordPattern = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

export function runProseLinterRules(context: ProseRuleContext): ProseRuleResult {
	const start = performance.now();
	const normalized = normalizeMarkdownForWritingAnalysis(context.content, { maskBlockquoteContent: true });
	const words = collectWords(normalized.normalizedContent, normalized.lineInfos);
	const lines = context.content.split('\n');
	const issues: ProseIssue[] = [];

	if (isProseIssueTypeEnabled(context.config, 'qualifier')) {
		issues.push(...findQualifierIssues(context, normalized.normalizedContent, lines, normalized.lineInfos));
	}
	if (isProseIssueTypeEnabled(context.config, 'complex-word')) {
		issues.push(...findComplexWordIssues(context, words, lines));
	}
	if (isProseIssueTypeEnabled(context.config, 'repeated-word')) {
		issues.push(...findRepeatedWordIssues(context, words, lines));
	}
	if (isProseIssueTypeEnabled(context.config, 'repeated-phrase')) {
		issues.push(...findRepeatedPhraseIssues(context, words, lines));
	}

	return {
		issues,
		elapsedMs: measureElapsedMs(start, performance.now())
	};
}

function collectWords(text: string, lineInfos: ReturnType<typeof normalizeMarkdownForWritingAnalysis>['lineInfos']): WordToken[] {
	const words: WordToken[] = [];
	wordPattern.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = wordPattern.exec(text)) !== null) {
		const start = indexToPosition(match.index, lineInfos);
		const end = indexToPosition(match.index + match[0].length, lineInfos);
		words.push({
			word: match[0],
			lower: match[0].toLowerCase(),
			startIndex: match.index,
			endIndex: match.index + match[0].length,
			line: start.line,
			startCh: start.ch,
			endCh: end.ch
		});
	}
	return words;
}

function findQualifierIssues(
	context: ProseRuleContext,
	normalizedContent: string,
	lines: string[],
	lineInfos: ReturnType<typeof normalizeMarkdownForWritingAnalysis>['lineInfos']
): ProseIssue[] {
	const issues: ProseIssue[] = [];
	const lowerContent = normalizedContent.toLowerCase();
	for (const phrase of QUALIFIER_PHRASES) {
		let cursor = 0;
		while (cursor < lowerContent.length) {
			const index = lowerContent.indexOf(phrase, cursor);
			if (index === -1) {
				break;
			}
			const before = index === 0 ? ' ' : lowerContent[index - 1];
			const after = lowerContent[index + phrase.length] ?? ' ';
			if (!isWordBoundary(before) || !isWordBoundary(after)) {
				cursor = index + phrase.length;
				continue;
			}
			const start = indexToPosition(index, lineInfos);
			const end = indexToPosition(index + phrase.length, lineInfos);
			const sourceText = extractSource(lines, start.line, start.ch, end.ch);
			issues.push(createIssue({
				context,
				type: 'qualifier',
				severity: 'suggestion',
				line: start.line,
				startCh: start.ch,
				endCh: end.ch,
				sourceText,
				explanation: 'This qualifier softens the point.',
				suggestion: 'Cut it or replace the sentence with the claim you mean.'
			}));
			cursor = index + phrase.length;
		}
	}
	return issues;
}

function findComplexWordIssues(context: ProseRuleContext, words: WordToken[], lines: string[]): ProseIssue[] {
	const issues: ProseIssue[] = [];
	for (const token of words) {
		const replacement = COMPLEX_WORD_REPLACEMENTS[token.lower];
		if (!replacement) {
			continue;
		}
		const sourceText = extractSource(lines, token.line, token.startCh, token.endCh);
		issues.push(createIssue({
			context,
			type: 'complex-word',
			severity: 'suggestion',
			line: token.line,
			startCh: token.startCh,
			endCh: token.endCh,
			sourceText,
			explanation: `"${sourceText}" is more complex than this sentence needs.`,
			suggestion: `Use "${replacement}" unless the formal word is doing real work.`,
			replacement: { source: sourceText, replacement: preserveCapitalization(sourceText, replacement) }
		}));
	}
	return issues;
}

function findRepeatedWordIssues(context: ProseRuleContext, words: WordToken[], lines: string[]): ProseIssue[] {
	const issues: ProseIssue[] = [];
	for (let index = 1; index < words.length; index++) {
		const previous = words[index - 1];
		const current = words[index];
		if (previous.lower !== current.lower || STOP_WORDS.has(current.lower)) {
			continue;
		}
		if (current.startIndex - previous.endIndex > 3) {
			continue;
		}
		const sourceText = extractSource(lines, previous.line, previous.startCh, current.endCh);
			issues.push(createIssue({
				context,
				type: 'repeated-word',
				severity: 'warning',
			line: previous.line,
			startCh: previous.startCh,
			endCh: current.endCh,
				sourceText,
				explanation: 'This looks like an accidental repeated word.',
				suggestion: 'Remove one copy.',
				replacement: { source: sourceText, replacement: previous.word },
				relatedRanges: [
					tokenToRange(previous),
					tokenToRange(current)
				]
			}));
	}
	return issues;
}

function findRepeatedPhraseIssues(context: ProseRuleContext, words: WordToken[], lines: string[]): ProseIssue[] {
	const issues: ProseIssue[] = [];
	const occupiedRanges: Array<{ startIndex: number; endIndex: number }> = [];

	for (const candidate of collectRepeatedPhraseCandidates(words)) {
		const firstToken = candidate.repeated.tokens[0];
		const lastToken = candidate.repeated.tokens[candidate.repeated.tokens.length - 1];
		const range = { startIndex: firstToken.startIndex, endIndex: lastToken.endIndex };
		if (occupiedRanges.some((occupied) => rangesOverlap(range, occupied))) {
			continue;
		}
		const sourceText = extractSource(lines, firstToken.line, firstToken.startCh, lastToken.endCh);
			issues.push(createIssue({
				context,
				type: 'repeated-phrase',
			severity: 'warning',
			line: firstToken.line,
			startCh: firstToken.startCh,
			endCh: lastToken.endCh,
				sourceText,
				explanation: `This phrase appears ${candidate.count} times nearby.`,
				suggestion: 'Keep the stronger use and rewrite or remove the echo.',
				relatedRanges: candidate.occurrences.map(occurrenceToRange)
			}));
			occupiedRanges.push(range);
		}
	return issues;
}

interface RepeatedPhraseOccurrence {
	tokens: WordToken[];
}

interface RepeatedPhraseCandidate {
	repeated: RepeatedPhraseOccurrence;
	occurrences: RepeatedPhraseOccurrence[];
	count: number;
	wordCount: number;
}

function collectRepeatedPhraseCandidates(words: WordToken[]): RepeatedPhraseCandidate[] {
	const candidates: RepeatedPhraseCandidate[] = [];

	for (let wordCount = MAX_REPEATED_PHRASE_WORDS; wordCount >= MIN_REPEATED_PHRASE_WORDS; wordCount--) {
		const occurrencesByPhrase = new Map<string, RepeatedPhraseOccurrence[]>();
		for (let index = 0; index <= words.length - wordCount; index++) {
			const tokens = words.slice(index, index + wordCount);
			if (!isRepeatedPhraseCandidate(tokens)) {
				continue;
			}
			const phrase = tokens.map((token) => token.lower).join(' ');
			const occurrences = occurrencesByPhrase.get(phrase) ?? [];
			occurrences.push({ tokens });
			occurrencesByPhrase.set(phrase, occurrences);
		}

		for (const occurrences of occurrencesByPhrase.values()) {
			const first = occurrences[0];
			const firstEndIndex = first.tokens[first.tokens.length - 1].endIndex;
			const nearbyOccurrences = occurrences.filter((occurrence) => {
				return occurrence === first ||
					(occurrence.tokens[0].startIndex >= firstEndIndex &&
						occurrence.tokens[0].startIndex - first.tokens[0].startIndex <= REPEATED_PHRASE_WINDOW_CHARS);
			});
			if (nearbyOccurrences.length < 2) {
				continue;
				}
				candidates.push({
					repeated: nearbyOccurrences[1],
					occurrences: nearbyOccurrences,
					count: nearbyOccurrences.length,
					wordCount
				});
			}
	}

	return candidates.sort((left, right) => {
		if (left.wordCount !== right.wordCount) {
			return right.wordCount - left.wordCount;
		}
		return left.repeated.tokens[0].startIndex - right.repeated.tokens[0].startIndex;
	});
}

function isRepeatedPhraseCandidate(tokens: WordToken[]): boolean {
	if (tokens.length < MIN_REPEATED_PHRASE_WORDS) {
		return false;
	}
	const line = tokens[0].line;
	if (!tokens.every((token) => token.line === line)) {
		return false;
	}
	const first = tokens[0];
	const last = tokens[tokens.length - 1];
	if (STOP_WORDS.has(first.lower) || STOP_WORDS.has(last.lower)) {
		return false;
	}
	return tokens.filter((token) => !STOP_WORDS.has(token.lower)).length >= MIN_REPEATED_PHRASE_WORDS;
}

function rangesOverlap(
	left: { startIndex: number; endIndex: number },
	right: { startIndex: number; endIndex: number }
): boolean {
	return left.startIndex < right.endIndex && right.startIndex < left.endIndex;
}

interface CreateRuleIssueInput {
	context: ProseRuleContext;
	type: ProseIssueType;
	severity: ProseIssueSeverity;
	line: number;
	startCh: number;
	endCh: number;
	sourceText: string;
	explanation: string;
	suggestion: string;
	replacement?: ProseIssue['replacement'];
	relatedRanges?: ProseIssueRange[];
}

function createIssue(input: CreateRuleIssueInput): ProseIssue {
	return {
		id: createProseIssueId(input.context.filePath, input.type, input.line, input.startCh, input.endCh, input.sourceText),
		ignoreKey: createProseIssueIgnoreKey(input.type, input.line, input.sourceText),
		type: input.type,
		severity: input.severity,
		line: input.line,
		startCh: input.startCh,
		endCh: input.endCh,
		excerpt: input.context.content.split('\n')[input.line]?.trim() ?? '',
		sourceText: input.sourceText,
		explanation: input.explanation,
		suggestion: input.suggestion,
		replacement: input.replacement,
		relatedRanges: input.relatedRanges
	};
}

function tokenToRange(token: WordToken): ProseIssueRange {
	return {
		line: token.line,
		startCh: token.startCh,
		endCh: token.endCh
	};
}

function occurrenceToRange(occurrence: RepeatedPhraseOccurrence): ProseIssueRange {
	const firstToken = occurrence.tokens[0];
	const lastToken = occurrence.tokens[occurrence.tokens.length - 1];
	return {
		line: firstToken.line,
		startCh: firstToken.startCh,
		endCh: lastToken.endCh
	};
}

function extractSource(lines: string[], line: number, startCh: number, endCh: number): string {
	const lineText = lines[line] ?? '';
	return lineText.slice(
		Math.max(0, Math.min(startCh, lineText.length)),
		Math.max(0, Math.min(endCh, lineText.length))
	);
}

function isWordBoundary(char: string): boolean {
	return !/[A-Za-z]/.test(char);
}

function preserveCapitalization(source: string, replacement: string): string {
	if (source.length === 0 || source[0] !== source[0].toUpperCase()) {
		return replacement;
	}
	return replacement.charAt(0).toUpperCase() + replacement.slice(1);
}
