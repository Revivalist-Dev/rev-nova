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
	'1.6.3': [
		'## What\'s New in Nova 1.6.3',
		'',
		'### New Models',
		'',
		'- **Claude Opus 4.8 is available.** Anthropic\'s latest Opus model is now selectable in the Claude model picker with its 1M-token context window.',
		'- **Opus requests avoid deprecated sampling settings.** Nova omits `temperature` for Opus 4.8, matching Anthropic\'s Messages API requirements so requests complete instead of returning a parameter error.',
	].join('\n'),
	'1.6.2': [
		'## What\'s New in Nova 1.6.2',
		'',
		'### Prose Linter Polish',
		'',
		'- **Ignored issues now persist per note.** Use Ignore to hide a specific issue in the current note, then restore it later from the ignored-items section when you want it back.',
		'- **Repeated phrase review is clearer.** Jump and editor highlights now account for related nearby phrase occurrences, making echoes easier to spot and revise.',
		'- **Weakener guidance is more practical.** Nova now focuses the suggestion on removing the weakener or choosing more exact wording instead of implying an AI rewrite.',
		'',
		'### Thanks',
		'',
		'Thanks to Helmut for the thoughtful suggestions!',
	].join('\n'),
	'1.6.1': [
		'## What\'s New in Nova 1.6.1',
		'',
		'### Ollama Improvements',
		'',
		'- **Ollama models now appear in the main model picker.** Testing your Ollama connection refreshes Nova\'s local model list, so configured Ollama models are available from the sidebar picker.',
		'- **Ollama settings are clearer.** The settings panel now explains that adding or removing local Ollama models requires testing the connection again to refresh the picker.',
		'- **Existing Ollama setups keep working.** Nova preserves your saved Ollama model during migration, even before the refreshed local model list is available.',
		'',
		'### Bug Fixes',
		'',
		'- **Reflective questions no longer trigger edit mode.** Messages like "I wish I knew..." now route to chat instead of being misread as edit requests.',
		'- **Long notes no longer hit an obsolete prompt-length guard.** Nova removed the old 10,000-character generated-prompt limit that could block short requests when the active note was large.',
	].join('\n'),
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
