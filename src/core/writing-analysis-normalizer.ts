/**
 * @file WritingAnalysisNormalizer - Position-stable Markdown masking for local writing analysis
 */

export interface LineInfo {
	text: string;
	start: number;
	length: number;
}

export interface FrontmatterInfo {
	startLine: number;
	endLine: number;
	optOut: boolean;
}

export interface NormalizedMarkdown {
	lines: string[];
	lineInfos: LineInfo[];
	normalizedContent: string;
	quoteLineFlags: boolean[];
	frontmatter: FrontmatterInfo | null;
	optOut: boolean;
}

export interface NormalizeMarkdownOptions {
	maskBlockquoteContent?: boolean;
	maskCalloutContent?: boolean;
	maskTableRows?: boolean;
	maskUrls?: boolean;
	maskWikilinks?: boolean;
	maskMarkdownLinks?: boolean;
	maskTags?: boolean;
	maskBlockIds?: boolean;
	maskSmartFillMarkers?: boolean;
}

const DEFAULT_OPTIONS: Required<NormalizeMarkdownOptions> = {
	maskBlockquoteContent: false,
	maskCalloutContent: true,
	maskTableRows: true,
	maskUrls: true,
	maskWikilinks: true,
	maskMarkdownLinks: true,
	maskTags: true,
	maskBlockIds: true,
	maskSmartFillMarkers: true
};

export function normalizeMarkdownForWritingAnalysis(
	content: string,
	options: NormalizeMarkdownOptions = {}
): NormalizedMarkdown {
	const resolvedOptions = { ...DEFAULT_OPTIONS, ...options };
	const lines = content.split('\n');
	const lineInfos = buildLineInfos(lines);
	const frontmatter = detectFrontmatter(lines);
	const normalizedLines = lines.map((line) => line);
	const quoteLineFlags = new Array<boolean>(lines.length).fill(false);

	blankFrontmatter(normalizedLines, frontmatter);
	blankFencedCodeBlocks(normalizedLines);
	blankInlineCode(normalizedLines);
	if (resolvedOptions.maskSmartFillMarkers) {
		blankSmartFillMarkers(normalizedLines);
	}
	if (resolvedOptions.maskCalloutContent) {
		blankCallouts(normalizedLines);
	}
	if (resolvedOptions.maskBlockquoteContent) {
		blankBlockquotes(normalizedLines, quoteLineFlags);
	} else {
		markBlockquotes(normalizedLines, quoteLineFlags);
	}
	if (resolvedOptions.maskTableRows) {
		blankTableRows(normalizedLines);
	}
	maskInlineMarkdown(normalizedLines, resolvedOptions);

	return {
		lines: normalizedLines,
		lineInfos,
		normalizedContent: normalizedLines.join('\n'),
		quoteLineFlags,
		frontmatter,
		optOut: frontmatter?.optOut ?? false
	};
}

export function buildLineInfos(lines: string[]): LineInfo[] {
	const infos: LineInfo[] = [];
	let start = 0;

	for (const line of lines) {
		infos.push({
			text: line,
			start,
			length: line.length
		});
		start += line.length + 1;
	}

	return infos;
}

export function indexToPosition(index: number, lineInfos: LineInfo[]): { line: number; ch: number } {
	if (lineInfos.length === 0) {
		return { line: 0, ch: 0 };
	}

	if (index >= lineInfos[lineInfos.length - 1].start + lineInfos[lineInfos.length - 1].length) {
		const last = lineInfos[lineInfos.length - 1];
		return { line: lineInfos.length - 1, ch: last.length };
	}

	let low = 0;
	let high = lineInfos.length - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const line = lineInfos[mid];
		const nextStart = mid + 1 < lineInfos.length ? lineInfos[mid + 1].start : Number.POSITIVE_INFINITY;

		if (index < line.start) {
			high = mid - 1;
			continue;
		}

		if (index >= nextStart) {
			low = mid + 1;
			continue;
		}

		return { line: mid, ch: index - line.start };
	}

	return { line: lineInfos.length - 1, ch: lineInfos[lineInfos.length - 1].length };
}

export function detectFrontmatter(lines: string[]): FrontmatterInfo | null {
	let startLine = 0;
	while (startLine < lines.length && lines[startLine].trim() === '') {
		startLine++;
	}

	if (startLine >= lines.length || lines[startLine].trim() !== '---') {
		return null;
	}

	let endLine = -1;
	for (let i = startLine + 1; i < lines.length; i++) {
		if (lines[i].trim() === '---') {
			endLine = i;
			break;
		}
	}

	if (endLine === -1) {
		return null;
	}

	let optOut = false;
	for (let i = startLine + 1; i < endLine; i++) {
		const match = lines[i].match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
		if (!match) {
			continue;
		}

		const key = match[1].toLowerCase();
		if (key !== 'nova-analysis') {
			continue;
		}

		const rawValue = stripQuotes(match[2]).toLowerCase();
		if (rawValue === 'false' || rawValue === 'off') {
			optOut = true;
		}
	}

	return {
		startLine,
		endLine,
		optOut
	};
}

function blankFrontmatter(lines: string[], frontmatter: FrontmatterInfo | null): void {
	if (!frontmatter) {
		return;
	}

	for (let i = frontmatter.startLine; i <= frontmatter.endLine; i++) {
		lines[i] = spaces(lines[i].length);
	}
}

function blankFencedCodeBlocks(lines: string[]): void {
	let inFence = false;
	let fenceChar = '';
	let fenceLength = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trimStart();
		const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

		if (!inFence) {
			if (!fenceMatch) {
				continue;
			}

			inFence = true;
			fenceChar = fenceMatch[1][0];
			fenceLength = fenceMatch[1].length;
			lines[i] = spaces(line.length);
			continue;
		}

		lines[i] = spaces(line.length);
		if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLength) {
			inFence = false;
			fenceChar = '';
			fenceLength = 0;
		}
	}
}

function blankInlineCode(lines: string[]): void {
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		if (line.indexOf('`') === -1) {
			continue;
		}

		const chars = line.split('');
		let cursor = 0;
		while (cursor < chars.length) {
			if (chars[cursor] !== '`') {
				cursor++;
				continue;
			}

			let runLength = 1;
			while (cursor + runLength < chars.length && chars[cursor + runLength] === '`') {
				runLength++;
			}

			let matchIndex = -1;
			for (let search = cursor + runLength; search < chars.length; search++) {
				if (chars[search] !== '`') {
					continue;
				}

				let closingLength = 1;
				while (search + closingLength < chars.length && chars[search + closingLength] === '`') {
					closingLength++;
				}

				if (closingLength === runLength) {
					matchIndex = search;
					break;
				}

				search += closingLength - 1;
			}

			if (matchIndex === -1) {
				cursor += runLength;
				continue;
			}

			replaceCharsWithSpaces(chars, cursor, matchIndex + runLength);
			cursor = matchIndex + runLength;
		}

		lines[lineIndex] = chars.join('');
	}
}

function blankSmartFillMarkers(lines: string[]): void {
	let inMarker = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lower = line.toLowerCase();
		if (!inMarker && lower.indexOf('<!--') === -1) {
			continue;
		}

		if (!inMarker && !/<!--\s*nova:/i.test(line)) {
			continue;
		}

		inMarker = true;
		lines[i] = spaces(line.length);
		if (lower.indexOf('-->') !== -1) {
			inMarker = false;
		}
	}
}

function blankCallouts(lines: string[]): void {
	let inCallout = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trimStart();
		if (/^>\s*\[![^\]]+\]/.test(trimmed)) {
			inCallout = true;
		} else if (inCallout && trimmed.length > 0 && !trimmed.startsWith('>')) {
			inCallout = false;
		}

		if (inCallout && trimmed.startsWith('>')) {
			lines[i] = spaces(line.length);
		}
	}
}

function blankBlockquotes(lines: string[], quoteLineFlags: boolean[]): void {
	for (let i = 0; i < lines.length; i++) {
		if (!/^\s*>/.test(lines[i])) {
			continue;
		}

		quoteLineFlags[i] = true;
		lines[i] = spaces(lines[i].length);
	}
}

function markBlockquotes(lines: string[], quoteLineFlags: boolean[]): void {
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const match = line.match(/^(\s*>+\s?)/);
		if (!match) {
			continue;
		}

		quoteLineFlags[i] = true;
		const chars = line.split('');
		replaceCharsWithSpaces(chars, 0, match[1].length);
		lines[i] = chars.join('');
	}
}

function blankTableRows(lines: string[]): void {
	for (let i = 0; i < lines.length; i++) {
		if (!isTableRow(lines, i)) {
			continue;
		}
		lines[i] = spaces(lines[i].length);
	}
}

function isTableRow(lines: string[], index: number): boolean {
	const line = lines[index];
	if (line.indexOf('|') === -1) {
		return false;
	}

	const trimmed = line.trim();
	if (trimmed.length === 0 || trimmed.startsWith('>')) {
		return false;
	}

	const previous = lines[index - 1]?.trim() ?? '';
	const next = lines[index + 1]?.trim() ?? '';
	return isMarkdownTableSeparator(trimmed) ||
		isMarkdownTableSeparator(previous) ||
		isMarkdownTableSeparator(next) ||
		(trimmed.startsWith('|') && trimmed.endsWith('|'));
}

function isMarkdownTableSeparator(line: string): boolean {
	if (line.indexOf('|') === -1) {
		return false;
	}
	const normalized = line.replace(/\|/g, '').trim();
	return normalized.length > 0 && /^[\s:-]+$/.test(normalized) && normalized.indexOf('-') !== -1;
}

function maskInlineMarkdown(lines: string[], options: Required<NormalizeMarkdownOptions>): void {
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const chars = lines[lineIndex].split('');
		if (options.maskMarkdownLinks) {
			maskMarkdownLinks(chars);
		}
		if (options.maskWikilinks) {
			maskWikilinks(chars);
		}
		if (options.maskUrls) {
			maskUrls(chars);
		}
		if (options.maskTags) {
			maskTags(chars);
		}
		if (options.maskBlockIds) {
			maskBlockIds(chars);
		}
		lines[lineIndex] = chars.join('');
	}
}

function maskMarkdownLinks(chars: string[]): void {
	let cursor = 0;
	while (cursor < chars.length) {
		const open = chars.indexOf('[', cursor);
		if (open === -1) {
			return;
		}

		const close = chars.indexOf(']', open + 1);
		if (close === -1 || chars[close + 1] !== '(') {
			cursor = open + 1;
			continue;
		}

		const end = chars.indexOf(')', close + 2);
		if (end === -1) {
			cursor = close + 1;
			continue;
		}

		if (open > 0 && chars[open - 1] === '!') {
			chars[open - 1] = ' ';
		}
		chars[open] = ' ';
		chars[close] = ' ';
		replaceCharsWithSpaces(chars, close + 1, end + 1);
		cursor = end + 1;
	}
}

function maskWikilinks(chars: string[]): void {
	let cursor = 0;
	while (cursor < chars.length - 1) {
		if (chars[cursor] !== '[' || chars[cursor + 1] !== '[') {
			cursor++;
			continue;
		}

		let end = -1;
		for (let search = cursor + 2; search < chars.length - 1; search++) {
			if (chars[search] === ']' && chars[search + 1] === ']') {
				end = search + 2;
				break;
			}
		}

		if (end === -1) {
			cursor += 2;
			continue;
		}

		replaceCharsWithSpaces(chars, cursor, end);
		cursor = end;
	}
}

function maskUrls(chars: string[]): void {
	let cursor = 0;
	while (cursor < chars.length) {
		const http = findNextUrlStart(chars, cursor);
		if (http === -1) {
			return;
		}

		let end = http;
		while (end < chars.length && !isUrlTerminator(chars[end])) {
			end++;
		}
		replaceCharsWithSpaces(chars, http, end);
		cursor = end;
	}
}

function findNextUrlStart(chars: string[], cursor: number): number {
	const haystack = chars.join('');
	const http = haystack.indexOf('http://', cursor);
	const https = haystack.indexOf('https://', cursor);
	if (http === -1) {
		return https;
	}
	if (https === -1) {
		return http;
	}
	return Math.min(http, https);
}

function isUrlTerminator(char: string): boolean {
	return /\s/.test(char) || char === ')' || char === ']' || char === '}';
}

function maskTags(chars: string[]): void {
	let cursor = 0;
	while (cursor < chars.length) {
		if (chars[cursor] !== '#') {
			cursor++;
			continue;
		}

		const previous = cursor === 0 ? ' ' : chars[cursor - 1];
		const next = chars[cursor + 1] ?? '';
		if (!/\s/.test(previous) || !/[A-Za-z0-9_/-]/.test(next)) {
			cursor++;
			continue;
		}

		let end = cursor + 1;
		while (end < chars.length && /[A-Za-z0-9_/-]/.test(chars[end])) {
			end++;
		}
		replaceCharsWithSpaces(chars, cursor, end);
		cursor = end;
	}
}

function maskBlockIds(chars: string[]): void {
	let cursor = 0;
	while (cursor < chars.length) {
		if (chars[cursor] !== '^') {
			cursor++;
			continue;
		}

		const next = chars[cursor + 1] ?? '';
		if (!/[A-Za-z0-9_-]/.test(next)) {
			cursor++;
			continue;
		}

		let end = cursor + 1;
		while (end < chars.length && /[A-Za-z0-9_-]/.test(chars[end])) {
			end++;
		}
		replaceCharsWithSpaces(chars, cursor, end);
		cursor = end;
	}
}

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}

function replaceCharsWithSpaces(chars: string[], start: number, endExclusive: number): void {
	for (let i = start; i < endExclusive && i < chars.length; i++) {
		chars[i] = ' ';
	}
}

function spaces(length: number): string {
	return ' '.repeat(length);
}
