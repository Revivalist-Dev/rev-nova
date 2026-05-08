/**
 * @file ProseLinterSummary - Display-ready summary values for the prose linter
 */

import type { WritingAnalysis } from '../../core/writing-analysis';
import { GENERAL_PROSE_CONFIG, PROSE_ISSUE_LABELS, PROSE_ISSUE_PRIORITY, type ProseIssue, type ProseIssueType } from './prose-linter-types';

export interface ProseLinterTopCategory {
	type: ProseIssueType;
	label: string;
	count: number;
}

export interface ProseLinterSummary {
	targetGrade: number;
	currentGrade: number;
	issueCount: number;
	issueDensityPerThousandWords: number;
	topCategories: ProseLinterTopCategory[];
	closestPath: string;
}

export interface BuildProseLinterSummaryInput {
	issues: ProseIssue[];
	analysis: WritingAnalysis;
	targetGrade?: number;
	visibleIssueTypes?: ReadonlySet<ProseIssueType>;
}

export function buildProseLinterSummary(input: BuildProseLinterSummaryInput): ProseLinterSummary {
	const targetGrade = input.targetGrade ?? GENERAL_PROSE_CONFIG.targetGrade;
	const visibleIssues = input.visibleIssueTypes
		? input.issues.filter((issue) => input.visibleIssueTypes?.has(issue.type))
		: input.issues;
	const topCategories = getTopCategories(visibleIssues);
	const issueDensityPerThousandWords = input.analysis.wordCount > 0
		? Math.round((visibleIssues.length / input.analysis.wordCount) * 1000 * 10) / 10
		: 0;

	return {
		targetGrade,
		currentGrade: input.analysis.readabilityGrade,
		issueCount: visibleIssues.length,
		issueDensityPerThousandWords,
		topCategories,
		closestPath: getClosestPath(visibleIssues, input.analysis.readabilityGrade, targetGrade)
	};
}

function getTopCategories(issues: ProseIssue[]): ProseLinterTopCategory[] {
	const counts = new Map<ProseIssueType, number>();
	for (const issue of issues) {
		counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);
	}

	return Array.from(counts.entries())
		.map(([type, count]) => ({ type, label: PROSE_ISSUE_LABELS[type], count }))
		.sort((left, right) => {
			if (right.count !== left.count) {
				return right.count - left.count;
			}
			return PROSE_ISSUE_PRIORITY[left.type] - PROSE_ISSUE_PRIORITY[right.type];
		})
		.slice(0, 3);
}

function getClosestPath(issues: ProseIssue[], currentGrade: number, targetGrade: number): string {
	if (issues.length === 0) {
		return currentGrade <= targetGrade
			? 'This draft is within the General prose target.'
			: 'No local issues found. Read once for structure and clarity.';
	}

	const first = [...issues].sort((left, right) => PROSE_ISSUE_PRIORITY[left.type] - PROSE_ISSUE_PRIORITY[right.type])[0];
	switch (first.type) {
		case 'very-long-sentence':
			return 'Start by splitting the very long sentences.';
		case 'sticky-sentence':
			return 'Start with the densest sentences.';
		case 'repeated-phrase':
			return 'Start by removing the most visible echoes.';
		case 'passive-voice':
			return 'Start by naming the actor in passive sentences.';
		case 'complex-word':
			return 'Start by replacing complex words with plainer ones.';
		case 'adverb':
		case 'weak-intensifier':
		case 'qualifier':
			return 'Start by cutting words that soften the point.';
		case 'repeated-word':
			return 'Start by removing accidental repeated words.';
		case 'sentence-start':
			return 'Start by varying repeated sentence openings.';
		case 'long-sentence':
			return 'Start by trimming long sentences.';
		case 'telling-language':
			return 'Start by replacing telling language with concrete action.';
	}
}
