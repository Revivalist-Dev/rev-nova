/**
 * @file ProseLinterRendering - Bounded issue list rendering helpers for the prose linter
 */

import type { ProseIssue, ProseIssueType } from './prose-linter-types';

export const PROSE_LINTER_INITIAL_VISIBLE_COUNT = 50;
export const PROSE_LINTER_LOAD_MORE_COUNT = 50;

export interface ProseIssuePageInput {
	issues: ProseIssue[];
	visibleCount?: number;
	hiddenIssueTypes?: ReadonlySet<ProseIssueType>;
	ignoredIssueIds?: ReadonlySet<string>;
	ignoredIssueTypes?: ReadonlySet<ProseIssueType>;
}

export interface ProseIssuePage {
	issues: ProseIssue[];
	totalVisibleIssues: number;
	visibleCount: number;
	hasMore: boolean;
	nextVisibleCount: number;
}

export function createProseIssuePage(input: ProseIssuePageInput): ProseIssuePage {
	const hiddenIssueTypes = input.hiddenIssueTypes ?? new Set<ProseIssueType>();
	const ignoredIssueIds = input.ignoredIssueIds ?? new Set<string>();
	const ignoredIssueTypes = input.ignoredIssueTypes ?? new Set<ProseIssueType>();
	const visibleCount = input.visibleCount ?? PROSE_LINTER_INITIAL_VISIBLE_COUNT;
	const visibleIssues = input.issues.filter((issue) => {
		return !hiddenIssueTypes.has(issue.type) &&
			!ignoredIssueIds.has(issue.id) &&
			!ignoredIssueTypes.has(issue.type);
	});
	const pageIssues = visibleIssues.slice(0, visibleCount);

	return {
		issues: pageIssues,
		totalVisibleIssues: visibleIssues.length,
		visibleCount,
		hasMore: visibleIssues.length > pageIssues.length,
		nextVisibleCount: Math.min(visibleIssues.length, visibleCount + PROSE_LINTER_LOAD_MORE_COUNT)
	};
}
