/**
 * @file Release notes content for each version.
 *
 * Add an entry before running `npm version`. Old entries can be pruned (keep ~5).
 */

import { isVersionNewer } from './utils/version';

export interface ReleaseNotesEntry {
	version: string;
	content: string;
	isCurrent: boolean;
}

export const RELEASE_NOTES: Record<string, string> = {
	// Add entries before running `npm version`. The /release command handles this.
	'1.6.0': [
		'## What\'s New in Nova 1.6.0',
		'',
		'### Prose Linter',
		'',
		'- **Sharper prose, native to Obsidian.** Nova now includes Prose Linter: a free, local clarity review pane for the current note. Open it from the command palette or the Writing panel to review sentence length, passive voice, adverbs, weak intensifiers, qualifiers, complex words, repeated words, and repeated phrases.',
		'- **Filled editor highlights make issues easy to see.** While Prose Linter is active, Nova highlights issues directly in the note with category colors. Switch back to the main Nova sidebar and the review highlights clear, keeping the Writing panel focused on metrics.',
		'- **Review issues one by one.** Each issue card includes an excerpt, explanation, practical suggestion, and actions. Use Jump to move to the exact text, Ignore to hide an issue for the session, and Apply only when Nova can verify a safe local replacement.',
		'- **Category filters keep noisy notes manageable.** Solid category buttons let you show or hide issue types, and large issue lists render in bounded batches so the pane stays responsive.',
		'',
		'### Writing Analysis',
		'',
		'- **Writing Analysis now uses snapshots.** Nova analyzes the current note when you open it, then marks results as edited after you make changes. This keeps large notes responsive instead of re-running analysis while you type.',
		'- **Manual refresh is clearer.** Click Analyze when you want fresh metrics. The last snapshot stays visible until then, so you can keep writing without losing context.',
		'',
		'### Polish and Reliability',
		'',
		'- **General prose margin hints were retired.** Smart Fill marker affordances remain, but general prose suggestions now live in Prose Linter where they can be filtered, explained, jumped to, and reviewed consistently.',
		'- **Large-note handling is safer.** Nova avoids stale review highlights after edits, validates exact ranges before applying local replacements, and keeps oversized analysis paths explicit.',
	].join('\n'),
	'1.5.5': [
		'## What\'s New in Nova 1.5.5',
		'',
		'### New Models',
		'- **GPT-5.5 and GPT-5.5 Pro are available.** OpenAI\'s latest GPT-5.5 models are now selectable in the model picker.',
		'',
		'### Release Notes',
		'- **Update notes now show more context.** When Nova opens the update notes tab, it now shows the current release plus two recent prior releases in a cleaner, easier-to-scan layout.',
	].join('\n'),
	'1.5.4': [
		'## What\'s New in Nova 1.5.4',
		'',
		'### Bug Fixes',
		'- **Claude Opus 4.7 now works.** 1.5.3 added Opus 4.7 to the model picker, but Anthropic removed support for the `temperature` parameter on this model, so every request returned a 400 error. Nova now omits `temperature` for Opus 4.7 requests while keeping it for every other model.',
		'- **Removed GPT-5.5 from the picker.** It was listed in 1.5.3 in anticipation of release, but OpenAI has not yet made the model available via API. It will be added back when the model ships.',
	].join('\n'),
	'1.5.3': [
		'## What\'s New in Nova 1.5.3',
		'',
		'### New Models',
		'- **Claude Opus 4.7** and **GPT-5.5** are now selectable in the model picker for their respective providers.',
		'',
		'### Bug Fixes',
		'- **Further reduced typing freezes in long notes.** 1.5.2 cut the problem back but didn\'t eliminate it. The scheduler now defers analysis to a browser idle slice once the debounce fires, so if you keep typing past the debounce, the work yields to your keystrokes instead of blocking them. The analyzer itself also does less work per run: duplicate passive-voice scans were removed, position lookups are deduped, and lines with no inline code skip an unnecessary per-character copy.',
	].join('\n'),
	'1.5.2': [
		'## What\'s New in Nova 1.5.2',
		'',
		'### Bug Fixes',
		'- **Typing no longer freezes in long notes.** The Writing Analysis subsystem was running a full-document scan after every short typing pause and accumulating memory in an unbounded cache. In long drafts this produced momentary keyboard unresponsiveness that resolved on its own or required a plugin reload. The cache is now bounded to a single entry, and the analysis debounce was raised from 500 ms to 1500 ms so ordinary mid-word pauses no longer trigger re-analysis.',
		'- **Very large documents skip live analysis.** Documents over 50,000 characters no longer run analysis on every keystroke, keeping the editor responsive while editing book-length drafts. Use the **Analyze** button in the sidebar to run analysis on demand.',
		'',
		'### Under the Hood',
		'- Tightened the Writing Analysis scheduling path so it skips cleanly when the editor isn\'t ready, instead of scheduling work against a not-yet-wired-up view.',
		'- Replaced an inline style assignment on the context budget bar with a CSS custom property, aligning with the rest of the plugin\'s Obsidian compliance patterns.',
	].join('\n'),
};

/**
 * Get release notes markdown for a given version, or null if none exist.
 */
export function getReleaseNotes(version: string): string | null {
	return RELEASE_NOTES[version] ?? null;
}

/**
 * Get the current release notes plus recent prior authored releases.
 */
export function getRecentReleaseNotes(currentVersion: string, count = 3): ReleaseNotesEntry[] {
	return Object.keys(RELEASE_NOTES)
		.filter(version => version === currentVersion || isVersionNewer(currentVersion, version))
		.sort((a, b) => {
			if (isVersionNewer(a, b)) return -1;
			if (isVersionNewer(b, a)) return 1;
			return 0;
		})
		.slice(0, count)
		.map(version => ({
			version,
			content: RELEASE_NOTES[version],
			isCurrent: version === currentVersion
		}));
}
