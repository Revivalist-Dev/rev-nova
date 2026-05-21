/**
 * @file ProseLinterStore - Note-scoped ignore persistence for the prose linter
 */

import { PROSE_ISSUE_LABELS, type ProseIssue, type ProseIssueType } from './prose-linter-types';

export interface ProseIgnoredIssueRecord {
	key: string;
	issueId: string;
	issueType: ProseIssueType;
	sourceHash: string;
	label: string;
	line: number;
	ignoredAt: number;
}

export interface ProseLinterStoreData {
	version: 2;
	notes: Record<string, {
		ignoredIssues: ProseIgnoredIssueRecord[];
		ignoredIssueTypes: ProseIssueType[];
		updatedAt: number;
	}>;
}

export interface ProseLinterStoreDataSource {
	loadData: () => Promise<unknown>;
	saveData: (data: ProseLinterStoreData) => Promise<void>;
	now?: () => number;
}

export class ProseLinterStore {
	private data: ProseLinterStoreData = createEmptyData();
	private loaded = false;
	private readonly dataSource: ProseLinterStoreDataSource;

	constructor(dataSource: ProseLinterStoreDataSource) {
		this.dataSource = dataSource;
	}

	async load(): Promise<void> {
		const raw = await this.dataSource.loadData();
		this.data = parseData(raw);
		this.loaded = true;
	}

	async ignoreIssueType(filePath: string, issueType: ProseIssueType): Promise<void> {
		await this.ensureLoaded();
		const note = this.getOrCreateNote(filePath);
		if (!note.ignoredIssueTypes.includes(issueType)) {
			note.ignoredIssueTypes.push(issueType);
		}
		note.updatedAt = this.now();
		await this.dataSource.saveData(this.data);
	}

	async ignoreIssue(filePath: string, issue: ProseIssue): Promise<void> {
		await this.ensureLoaded();
		const note = this.getOrCreateNote(filePath);
		const record: ProseIgnoredIssueRecord = {
			key: issue.ignoreKey,
			issueId: issue.id,
			issueType: issue.type,
			sourceHash: getSourceHashFromIgnoreKey(issue.ignoreKey),
			label: PROSE_ISSUE_LABELS[issue.type],
			line: issue.line,
			ignoredAt: this.now()
		};
		const existingIndex = note.ignoredIssues.findIndex((ignored) => ignored.key === record.key);
		if (existingIndex >= 0) {
			note.ignoredIssues[existingIndex] = record;
		} else {
			note.ignoredIssues.push(record);
		}
		note.updatedAt = this.now();
		await this.dataSource.saveData(this.data);
	}

	async restoreIssue(filePath: string, key: string): Promise<void> {
		await this.ensureLoaded();
		const note = this.getOrCreateNote(filePath);
		note.ignoredIssues = note.ignoredIssues.filter((issue) => issue.key !== key);
		note.updatedAt = this.now();
		await this.dataSource.saveData(this.data);
	}

	async restoreIssueType(filePath: string, issueType: ProseIssueType): Promise<void> {
		await this.ensureLoaded();
		const note = this.getOrCreateNote(filePath);
		note.ignoredIssueTypes = note.ignoredIssueTypes.filter((type) => type !== issueType);
		note.updatedAt = this.now();
		await this.dataSource.saveData(this.data);
	}

	getIgnoredIssueTypes(filePath: string | null): ReadonlySet<ProseIssueType> {
		if (!filePath) {
			return new Set();
		}
		const note = this.data.notes[filePath];
		return new Set(note?.ignoredIssueTypes ?? []);
	}

	getIgnoredIssues(filePath: string | null): ProseIgnoredIssueRecord[] {
		if (!filePath) {
			return [];
		}
		const note = this.data.notes[filePath];
		return [...(note?.ignoredIssues ?? [])].sort((left, right) => right.ignoredAt - left.ignoredAt);
	}

	getIgnoredIssueKeys(filePath: string | null, issues?: readonly ProseIssue[]): ReadonlySet<string> {
		const ignoredIssues = this.getIgnoredIssues(filePath);
		if (!issues) {
			return new Set(ignoredIssues.map((issue) => issue.key));
		}

		return new Set(issues
			.filter((issue) => ignoredIssues.some((ignoredIssue) => doesIgnoredIssueMatch(issue, ignoredIssue)))
			.map((issue) => issue.ignoreKey));
	}

	isIssueTypeIgnored(filePath: string | null, issueType: ProseIssueType): boolean {
		return this.getIgnoredIssueTypes(filePath).has(issueType);
	}

	getDataForTests(): ProseLinterStoreData {
		return JSON.parse(JSON.stringify(this.data)) as ProseLinterStoreData;
	}

	private async ensureLoaded(): Promise<void> {
		if (!this.loaded) {
			await this.load();
		}
	}

	private getOrCreateNote(filePath: string): ProseLinterStoreData['notes'][string] {
		if (!this.data.notes[filePath]) {
			this.data.notes[filePath] = {
				ignoredIssues: [],
				ignoredIssueTypes: [],
				updatedAt: this.now()
			};
		}
		return this.data.notes[filePath];
	}

	private now(): number {
		return this.dataSource.now?.() ?? Date.now();
	}
}

function parseData(raw: unknown): ProseLinterStoreData {
	if (!raw || typeof raw !== 'object') {
		return createEmptyData();
	}
	const candidate = raw as { version?: unknown; notes?: unknown };
	if ((candidate.version !== 1 && candidate.version !== 2) || !candidate.notes || typeof candidate.notes !== 'object') {
		return createEmptyData();
	}

	const notes: ProseLinterStoreData['notes'] = {};
	for (const [filePath, note] of Object.entries(candidate.notes)) {
		if (!note || typeof note !== 'object') {
			continue;
		}
		const typedNote = note as { ignoredIssues?: unknown; ignoredIssueTypes?: unknown; updatedAt?: unknown };
		notes[filePath] = {
			ignoredIssues: Array.isArray(typedNote.ignoredIssues)
				? typedNote.ignoredIssues.map(parseIgnoredIssue).filter((issue): issue is ProseIgnoredIssueRecord => Boolean(issue))
				: [],
			ignoredIssueTypes: Array.isArray(typedNote.ignoredIssueTypes)
				? typedNote.ignoredIssueTypes.filter(isKnownIssueType)
				: [],
			updatedAt: typeof typedNote.updatedAt === 'number' ? typedNote.updatedAt : 0
		};
	}

	return { version: 2, notes };
}

function createEmptyData(): ProseLinterStoreData {
	return {
		version: 2,
		notes: {}
	};
}

function parseIgnoredIssue(value: unknown): ProseIgnoredIssueRecord | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const candidate = value as Partial<ProseIgnoredIssueRecord>;
	if (
		typeof candidate.key !== 'string' ||
		typeof candidate.issueId !== 'string' ||
		!isKnownIssueType(candidate.issueType) ||
		typeof candidate.line !== 'number' ||
		typeof candidate.ignoredAt !== 'number'
	) {
		return null;
	}

	return {
		key: candidate.key,
		issueId: candidate.issueId,
		issueType: candidate.issueType,
		sourceHash: typeof candidate.sourceHash === 'string'
			? candidate.sourceHash
			: getSourceHashFromIgnoreKey(candidate.key),
		label: typeof candidate.label === 'string' ? candidate.label : PROSE_ISSUE_LABELS[candidate.issueType],
		line: candidate.line,
		ignoredAt: candidate.ignoredAt
	};
}

function doesIgnoredIssueMatch(issue: ProseIssue, ignoredIssue: ProseIgnoredIssueRecord): boolean {
	if (issue.id === ignoredIssue.issueId || issue.ignoreKey === ignoredIssue.key) {
		return true;
	}
	if (issue.type !== ignoredIssue.issueType) {
		return false;
	}
	return getSourceHashFromIgnoreKey(issue.ignoreKey) === ignoredIssue.sourceHash &&
		Math.abs(issue.line - ignoredIssue.line) <= 3;
}

function getSourceHashFromIgnoreKey(ignoreKey: string): string {
	return ignoreKey.split(':').at(-1) ?? '';
}

function isKnownIssueType(value: unknown): value is ProseIssueType {
	return typeof value === 'string' && [
		'long-sentence',
		'very-long-sentence',
		'passive-voice',
		'adverb',
		'weak-intensifier',
		'qualifier',
		'complex-word',
		'repeated-word',
		'repeated-phrase',
		'sticky-sentence',
		'sentence-start',
		'telling-language'
	].includes(value);
}
