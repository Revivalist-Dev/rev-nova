/**
 * @file WritingAnalysisRunner - Shared run-token helpers for deterministic writing analysis
 */

export interface AnalysisRunToken {
	filePath: string | null;
	contentHash: string;
	sequence: number;
}

export function createAnalysisRunToken(filePath: string | null, contentHash: string, sequence: number): AnalysisRunToken {
	return { filePath, contentHash, sequence };
}

export function isStaleAnalysisRun(current: AnalysisRunToken, candidate: AnalysisRunToken): boolean {
	return current.sequence !== candidate.sequence ||
		current.filePath !== candidate.filePath ||
		current.contentHash !== candidate.contentHash;
}

export function measureElapsedMs(start: number, end: number): number {
	return Math.max(0, end - start);
}
