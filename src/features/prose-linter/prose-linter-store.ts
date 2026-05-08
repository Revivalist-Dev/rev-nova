/**
 * @file ProseLinterStore - Note-scoped ignore persistence for the prose linter
 */

import type { ProseIssueType } from './prose-linter-types';

export interface ProseLinterStoreData {
	version: 1;
	notes: Record<string, {
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
	const candidate = raw as Partial<ProseLinterStoreData>;
	if (candidate.version !== 1 || !candidate.notes || typeof candidate.notes !== 'object') {
		return createEmptyData();
	}

	const notes: ProseLinterStoreData['notes'] = {};
	for (const [filePath, note] of Object.entries(candidate.notes)) {
		if (!note || typeof note !== 'object') {
			continue;
		}
		const typedNote = note as { ignoredIssueTypes?: unknown; updatedAt?: unknown };
		notes[filePath] = {
			ignoredIssueTypes: Array.isArray(typedNote.ignoredIssueTypes)
				? typedNote.ignoredIssueTypes.filter(isKnownIssueType)
				: [],
			updatedAt: typeof typedNote.updatedAt === 'number' ? typedNote.updatedAt : 0
		};
	}

	return { version: 1, notes };
}

function createEmptyData(): ProseLinterStoreData {
	return {
		version: 1,
		notes: {}
	};
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
