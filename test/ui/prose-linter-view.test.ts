/**
 * @file ProseLinterView Test Suite
 */

import { Editor, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { analyzeWriting, hashContent } from '../../src/core/writing-analysis';
import { createAnalysisRunToken } from '../../src/core/writing-analysis-runner';
import { ProseLinterStore } from '../../src/features/prose-linter/prose-linter-store';
import { ProseLinterView } from '../../src/ui/prose-linter-view';

describe('ProseLinterView', () => {
	beforeEach(() => {
		installDomHelpers();
	});

	function createPlugin(content: string, path = 'notes/current.md') {
		const file = new TFile(path);
		const editor = new Editor(content);
		const markdownView = new MarkdownView(null);
		markdownView.file = file;
		markdownView.editor = editor;
		const workspace = {
			getActiveViewOfType: jest.fn((viewType: unknown) => viewType === MarkdownView ? markdownView : null),
			on: jest.fn(() => ({ unsubscribe: () => undefined })),
			openLinkText: jest.fn(async () => undefined),
			getLeavesOfType: jest.fn(() => []),
			getRightLeaf: jest.fn(() => new WorkspaceLeaf()),
			revealLeaf: jest.fn()
		};
		const store = new ProseLinterStore({
			loadData: async () => null,
			saveData: async () => undefined,
			now: () => 1
		});
		const plugin = {
			app: {
				workspace,
				vault: {
					cachedRead: jest.fn(async () => content)
				}
			},
			proseLinterStore: store,
			writingAnalysisManager: {
				getActiveFile: jest.fn(() => file),
				getActiveContent: jest.fn(() => content),
				getActiveEditor: jest.fn(() => editor),
				getActiveRunToken: jest.fn(() => createAnalysisRunToken(path, hashContent(content), 1)),
				setProseLinterIssues: jest.fn(),
				clearProseLinterHighlights: jest.fn()
			},
			registerDomEvent: jest.fn((element: HTMLElement, type: string, handler: EventListener) => {
				element.addEventListener(type, handler);
			})
		};

		return { plugin, file, editor, markdownView, workspace, store };
	}

	async function openView(plugin: ReturnType<typeof createPlugin>['plugin']): Promise<ProseLinterView> {
		const view = new ProseLinterView(new WorkspaceLeaf(), plugin as never);
		await view.onOpen();
		return view;
	}

	test('renders a no-note state without Supernova or provider setup copy', async () => {
		const { plugin } = createPlugin('');
		plugin.writingAnalysisManager.getActiveFile.mockReturnValue(null);
		plugin.writingAnalysisManager.getActiveContent.mockReturnValue(null);
		plugin.writingAnalysisManager.getActiveEditor.mockReturnValue(null);
		plugin.app.workspace.getActiveViewOfType.mockReturnValue(null);

		const view = await openView(plugin);
		const text = view.containerEl.textContent ?? '';

		expect(view.getDisplayText()).toBe('Nova prose linter');
		expect(text).toContain('Nova');
		expect(text).toContain('Open a markdown note');
		expect(text).not.toContain('Supernova');
		expect(text).not.toContain('API key');
		expect(text).not.toContain('provider');
	});

	test('renders a compact Hemingway-style review with category cards and bounded issue rows', async () => {
		const content = [
			'Maybe we should utilize numerous screenshots.',
			'The launch was approved quickly.',
			'The draft draft needs work.',
			'Clear launch story matters because clear launch story spreads fast.',
			'This sentence contains enough simple words to cross the long sentence threshold and show up in the linter today.'
		].join('\n');
		const { plugin } = createPlugin(content);
		const view = await openView(plugin);
		const text = view.containerEl.textContent ?? '';

		expect(text).toContain('Grade');
		expect(text).toContain('words');
		expect(text).toContain('weakeners');
		expect(text).toContain('words with simpler alternatives');
		expect(text).toContain('Jump');
		expect(text).not.toContain('per 1,000 words');
		expect(text).not.toContain('Top categories');
		expect(text).not.toContain('Previous');
		expect(text).not.toContain('Toggle category');
		expect(text).not.toContain('Ignore type');
		expect(view.containerEl.querySelectorAll('.nova-prose-linter-category').length).toBeGreaterThan(0);
		expect(view.containerEl.querySelectorAll('.nova-prose-linter-row').length).toBeGreaterThan(0);
		expect(view.containerEl.querySelector('.nova-prose-linter-row--qualifier')).toBeTruthy();
		expect(view.containerEl.querySelector('.nova-prose-linter-row--complex-word')).toBeTruthy();
		expect(plugin.writingAnalysisManager.setProseLinterIssues).toHaveBeenCalledWith(
			'notes/current.md',
			hashContent(content),
			expect.arrayContaining([
				expect.objectContaining({ type: 'qualifier' }),
				expect.objectContaining({ type: 'complex-word' })
			])
		);
	});

	test('jump selects the current issue range', async () => {
		const content = 'Maybe we should use plain words.';
		const { plugin, editor } = createPlugin(content);
		const selectionSpy = jest.spyOn(editor, 'setSelection');
		const view = await openView(plugin);

		const jumpButton = Array.from(view.containerEl.querySelectorAll('button'))
			.find((button) => button.textContent === 'Jump') as HTMLButtonElement;
		jumpButton.click();

		expect(selectionSpy).toHaveBeenCalledWith({ line: 0, ch: 0 }, { line: 0, ch: 5 });
	});

	test('shows Apply only for exact safe replacements and applies through the editor API', async () => {
		const content = 'We should utilize screenshots.';
		const { plugin, editor } = createPlugin(content);
		const replaceSpy = jest.spyOn(editor, 'replaceRange');
		const view = await openView(plugin);

		const applyButton = Array.from(view.containerEl.querySelectorAll('button'))
			.find((button) => button.textContent === 'Apply') as HTMLButtonElement;

		expect(applyButton).toBeDefined();
		applyButton.click();

		expect(replaceSpy).toHaveBeenCalledWith('use', { line: 0, ch: 10 }, { line: 0, ch: 17 });
	});

	test('hides a category from the current view without persisting it', async () => {
		const content = 'Maybe we should utilize screenshots.';
		const { plugin, store } = createPlugin(content);
		const saveSpy = jest.spyOn(store as never, 'ignoreIssueType');
		const view = await openView(plugin);

		const categoryButton = view.containerEl.querySelector('.nova-prose-linter-category--weakeners') as HTMLButtonElement;
		categoryButton.click();

		expect(view.containerEl.textContent).not.toContain('This qualifier softens the point.');
		expect(saveSpy).not.toHaveBeenCalled();
	});

	test('turns a loaded category off on the first click', async () => {
		const content = 'Maybe we should utilize screenshots.';
		const { plugin } = createPlugin(content);
		const view = await openView(plugin);

		const categoryButton = view.containerEl.querySelector('.nova-prose-linter-category--weakeners') as HTMLButtonElement;
		expect(categoryButton.getAttribute('aria-pressed')).toBe('true');

		categoryButton.click();

		const updatedCategoryButton = view.containerEl.querySelector('.nova-prose-linter-category--weakeners') as HTMLButtonElement;
		const latestHighlightCall = plugin.writingAnalysisManager.setProseLinterIssues.mock.calls.at(-1);

		expect(updatedCategoryButton.getAttribute('aria-pressed')).toBe('false');
		expect(updatedCategoryButton.classList.contains('nova-prose-linter-category--muted')).toBe(true);
		expect(view.containerEl.textContent).not.toContain('This qualifier softens the point.');
		expect(view.containerEl.textContent).toContain('"utilize" is more complex than this sentence needs.');
		expect(latestHighlightCall?.[2]).toEqual(expect.not.arrayContaining([
			expect.objectContaining({ type: 'qualifier' })
		]));
	});

	test('turns a very hard sentence category off on the first pointer press', async () => {
		const content = 'This sentence keeps moving through the launch story, the product promise, the onboarding details, the screenshot plan, the support expectations, and the follow-up work because it tries to solve too many problems at once without giving the reader a clean place to rest or decide what matters most.';
		const { plugin } = createPlugin(content);
		const view = await openView(plugin);

		const categoryButton = view.containerEl.querySelector('.nova-prose-linter-category--very-hard') as HTMLButtonElement;
		expect(categoryButton.getAttribute('aria-pressed')).toBe('true');

		categoryButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
		categoryButton.click();

		const updatedCategoryButton = view.containerEl.querySelector('.nova-prose-linter-category--very-hard') as HTMLButtonElement;
		const latestHighlightCall = plugin.writingAnalysisManager.setProseLinterIssues.mock.calls.at(-1);

		expect(updatedCategoryButton.getAttribute('aria-pressed')).toBe('false');
		expect(updatedCategoryButton.classList.contains('nova-prose-linter-category--muted')).toBe(true);
		expect(view.containerEl.textContent).not.toContain('This sentence has');
		expect(latestHighlightCall?.[2]).toEqual(expect.not.arrayContaining([
			expect.objectContaining({ type: 'very-long-sentence' })
		]));
	});

	test('ignores one issue locally without persisting note content', async () => {
		const content = 'Maybe we should utilize screenshots.';
		let saved: unknown = null;
		const { plugin } = createPlugin(content);
		plugin.proseLinterStore = new ProseLinterStore({
			loadData: async () => null,
			saveData: async (data) => {
				saved = data;
			},
			now: () => 10
		});
		const view = await openView(plugin);

		const ignoreButton = Array.from(view.containerEl.querySelectorAll('button'))
			.find((button) => button.textContent === 'Ignore') as HTMLButtonElement;
		ignoreButton.click();
		await Promise.resolve();

		expect(saved).toBeNull();
		expect(view.containerEl.textContent).not.toContain('"utilize" is more complex than this sentence needs.');
		expect(JSON.stringify(saved)).not.toContain('Maybe');
		expect(JSON.stringify(saved)).not.toContain('utilize');
	});

	test('uses local analysis for the current note', async () => {
		const content = 'The launch was approved quickly.';
		const { plugin } = createPlugin(content);
		const analysis = analyzeWriting(content);
		const view = await openView(plugin);

		expect(view.containerEl.textContent).toContain('Grade');
		expect(view.containerEl.textContent).toContain(`${Math.round(analysis.readabilityGrade)}`);
	});

	test('clears Prose Linter editor highlights when the view closes', async () => {
		const content = 'Maybe we should utilize screenshots.';
		const { plugin } = createPlugin(content);
		const view = await openView(plugin);

		await view.onClose();

		expect(plugin.writingAnalysisManager.clearProseLinterHighlights).toHaveBeenCalledWith('notes/current.md');
	});
});

function installDomHelpers(): void {
	const proto = HTMLElement.prototype as HTMLElement & {
		empty?: () => void;
		createEl?: (tag: keyof HTMLElementTagNameMap, attrs?: { text?: string; cls?: string; attr?: Record<string, string> }) => HTMLElement;
		createDiv?: (attrs?: { cls?: string; text?: string }) => HTMLDivElement;
		createSpan?: (attrs?: { cls?: string; text?: string }) => HTMLSpanElement;
		setText?: (text: string) => void;
		addClass?: (cls: string) => void;
		removeClass?: (cls: string) => void;
	};

	proto.empty = function empty() {
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
	};
	proto.createEl = function createEl(tag, attrs) {
		const el = document.createElement(tag);
		if (attrs?.text) {
			el.textContent = attrs.text;
		}
		if (attrs?.cls) {
			el.className = attrs.cls;
		}
		if (attrs?.attr) {
			Object.entries(attrs.attr).forEach(([key, value]) => el.setAttribute(key, value));
		}
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function createDiv(attrs) {
		return this.createEl?.('div', attrs) as HTMLDivElement;
	};
	proto.createSpan = function createSpan(attrs) {
		return this.createEl?.('span', attrs) as HTMLSpanElement;
	};
	proto.setText = function setText(text: string) {
		this.textContent = text;
	};
	proto.addClass = function addClass(cls: string) {
		this.classList.add(cls);
	};
	proto.removeClass = function removeClass(cls: string) {
		this.classList.remove(cls);
	};
}
