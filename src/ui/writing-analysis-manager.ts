/**
 * @file WritingAnalysisManager - Coordinates deterministic writing analysis for the active Markdown editor
 */

import { Editor, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { analyzeWriting, hashContent, hasWritingAnalysisOptOut, MAX_LIVE_ANALYSIS_CHAR_LENGTH, type WritingAnalysis } from '../core/writing-analysis';
import { createAnalysisRunToken, isStaleAnalysisRun, type AnalysisRunToken } from '../core/writing-analysis-runner';
import { CodeMirrorWritingHighlightManager, type WritingHighlight } from '../features/commands/ui/codemirror-decorations';
import { PROSE_ISSUE_LABELS, type ProseIssue } from '../features/prose-linter/prose-linter-types';
import { VIEW_TYPE_NOVA_SIDEBAR, VIEW_TYPE_PROSE_LINTER } from '../constants';
import { VIEW_TYPE_WRITING_DASHBOARD } from './writing-dashboard-view';
import { Logger } from '../utils/logger';
import { TimeoutManager } from '../utils/timeout-manager';
import type NovaPlugin from '../../main';

export const WRITING_ANALYSIS_UPDATED_EVENT = 'nova-writing-analysis-updated';

export interface WritingAnalysisUpdateDetail {
    analysis: WritingAnalysis | null;
    filePath: string | null;
    eligible: boolean;
    disabledByFrontmatter: boolean;
    runToken: AnalysisRunToken;
}

export class WritingAnalysisManager {
    private static readonly ANALYSIS_DEBOUNCE_MS = 1500;
    // Upper bound on how long requestIdleCallback may defer the analysis past
    // the debounce. Ensures live stats refresh within ~2s of the last keystroke
    // even if the browser never reports an idle slice.
    private static readonly ANALYSIS_IDLE_TIMEOUT_MS = 2000;

    private plugin: NovaPlugin;
    private logger = Logger.scope('WritingAnalysisManager');
    private timeoutManager = new TimeoutManager();
    private activeView: MarkdownView | null = null;
    private highlightManager: CodeMirrorWritingHighlightManager | null = null;
    private latestAnalysis: WritingAnalysis | null = null;
    private disabledByFrontmatter = false;
    private observedEditors = new WeakSet<HTMLElement>();
    private pendingAnalysisTimeout: number | null = null;
    private pendingIdleHandle: number | null = null;
    private currentLeafViewType: string | null = null;
    private analysisSequence = 0;
    private activeRunToken: AnalysisRunToken = createAnalysisRunToken(null, '', 0);
    private proseLinterHighlights: WritingHighlight[] | null = null;
    private proseLinterHighlightFilePath: string | null = null;
    private proseLinterHighlightContentHash: string | null = null;
    private proseLinterReviewActive = false;
    private pendingReviewModeReconcileTimeout: number | null = null;

    constructor(plugin: NovaPlugin) {
        this.plugin = plugin;
    }

    init(): void {
        this.plugin.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', (leaf) => {
                this.handleActiveLeafChange(leaf ?? null);
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('file-open', () => {
                void this.refreshForActiveView(true);
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('layout-change', () => {
                this.scheduleProseLinterReviewReconcile();
            })
        );

        this.plugin.registerEvent(
            this.plugin.app.workspace.on('resize', () => {
                this.scheduleProseLinterReviewReconcile();
            })
        );

        this.plugin.registerDomEvent(document, 'click', (event: MouseEvent) => {
            this.handleWorkspaceInteraction(event);
        }, { capture: true });

        this.plugin.registerDomEvent(document, 'pointerdown', (event: PointerEvent) => {
            this.handleWorkspaceInteraction(event);
        }, { capture: true });

        this.plugin.registerDomEvent(document, 'focusin', (event: FocusEvent) => {
            this.handleWorkspaceInteraction(event);
        }, { capture: true });

        this.reconcileProseLinterReviewMode();
        void this.refreshForActiveView(true);
    }

    async refreshForActiveView(force = false): Promise<void> {
        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

        if (!this.isEligibleView(activeView)) {
            // Keep the current analysis visible only when focus moved into
            // Nova's own sidebar. Other workspace views, such as the writing
            // dashboard, should clear the panel.
            if (this.shouldPreserveCurrentAnalysis()) {
                return;
            }
            this.activeView = null;
            this.highlightManager = null;
            this.latestAnalysis = null;
            this.disabledByFrontmatter = false;
            this.invalidateAnalysisRun(null);
            this.clearHighlights();
            this.emitUpdate(false);
            return;
        }

        const viewChanged = activeView !== this.activeView;
        this.activeView = activeView;

        if (viewChanged) {
            this.setupHighlightManager();
            this.setupEditorListeners();
        }

        if (force || viewChanged) {
            await this.runAnalysis();
        }
    }

    updateSettings(): void {
        if (!this.plugin.settings.writingAnalysis.enabled) {
            this.latestAnalysis = null;
            this.disabledByFrontmatter = false;
            this.invalidateAnalysisRun(this.activeView?.file?.path ?? null);
            this.clearHighlights();
            this.emitUpdate(this.isEligibleView(this.activeView));
            return;
        }

        void this.runAnalysis();
    }

    scheduleAnalysis(): void {
        if (!this.plugin.settings.writingAnalysis.enabled || !this.isEligibleView(this.activeView)) {
            return;
        }

        const cm = this.getEditorView();
        if (!cm || cm.state.doc.length > MAX_LIVE_ANALYSIS_CHAR_LENGTH) {
            // Skip live analysis on very large docs, or when CodeMirror
            // isn't wired up yet. analyzeNow() still runs on demand.
            return;
        }

        this.cancelPendingAnalysis();

        this.pendingAnalysisTimeout = this.timeoutManager.addTimeout(() => {
            this.pendingAnalysisTimeout = null;
            // Defer the actual work to a browser idle slice so it yields to
            // ongoing typing. The trailing-edge debounce alone still runs
            // synchronously if typing resumes right as the timer fires.
            this.pendingIdleHandle = requestIdleAnalysis(() => {
                this.pendingIdleHandle = null;
                void this.runAnalysis();
            }, WritingAnalysisManager.ANALYSIS_IDLE_TIMEOUT_MS);
        }, WritingAnalysisManager.ANALYSIS_DEBOUNCE_MS);
    }

    async analyzeNow(): Promise<void> {
        this.cancelPendingAnalysis();
        await this.runAnalysis();
    }

    private cancelPendingAnalysis(): void {
        if (this.pendingAnalysisTimeout) {
            this.timeoutManager.removeTimeout(this.pendingAnalysisTimeout);
            this.pendingAnalysisTimeout = null;
        }
        if (this.pendingIdleHandle !== null) {
            cancelIdleAnalysis(this.pendingIdleHandle);
            this.pendingIdleHandle = null;
        }
    }

    getLatestAnalysis(): WritingAnalysis | null {
        return this.latestAnalysis;
    }

    getActiveFile(): TFile | null {
        return this.activeView?.file ?? null;
    }

    getActiveEditor(): Editor | null {
        return this.activeView?.editor ?? null;
    }

    getActiveContent(): string | null {
        return this.activeView?.editor?.getValue() ?? null;
    }

    isEligibleActiveFile(): boolean {
        return this.isEligibleView(this.activeView);
    }

    isDisabledByFrontmatter(): boolean {
        return this.disabledByFrontmatter;
    }

    getActiveRunToken(): AnalysisRunToken {
        return this.activeRunToken;
    }

    setProseLinterIssues(filePath: string, contentHash: string, issues: ProseIssue[]): void {
        if (!this.isCurrentProseLinterTarget(filePath, contentHash)) {
            return;
        }

        this.proseLinterHighlights = issues
            .map(issue => this.createHighlight(
                issue.line,
                issue.startCh,
                issue.endCh,
                issue.type,
                `${PROSE_ISSUE_LABELS[issue.type]}: ${issue.suggestion}`
            ))
            .filter((highlight): highlight is WritingHighlight => Boolean(highlight));
        this.proseLinterHighlightFilePath = filePath;
        this.proseLinterHighlightContentHash = contentHash;
        this.applyHighlights();
    }

    clearProseLinterHighlights(filePath?: string): void {
        if (filePath && this.proseLinterHighlightFilePath && this.proseLinterHighlightFilePath !== filePath) {
            return;
        }
        this.proseLinterHighlights = null;
        this.proseLinterHighlightFilePath = null;
        this.proseLinterHighlightContentHash = null;
        this.applyHighlights();
    }

    setProseLinterReviewActive(active: boolean): void {
        if (this.proseLinterReviewActive === active) {
            return;
        }
        this.proseLinterReviewActive = active;
        this.applyHighlights();
    }

    cleanup(): void {
        this.timeoutManager.clearAll();
        this.pendingAnalysisTimeout = null;
        this.pendingReviewModeReconcileTimeout = null;
        if (this.pendingIdleHandle !== null) {
            cancelIdleAnalysis(this.pendingIdleHandle);
            this.pendingIdleHandle = null;
        }
        this.clearHighlights();
        this.proseLinterHighlights = null;
        this.proseLinterHighlightFilePath = null;
        this.proseLinterHighlightContentHash = null;
        this.activeView = null;
        this.highlightManager = null;
        this.latestAnalysis = null;
        this.invalidateAnalysisRun(null);
    }

    private async runAnalysis(): Promise<void> {
        if (!this.plugin.settings.writingAnalysis.enabled || !this.isEligibleView(this.activeView)) {
            this.latestAnalysis = null;
            this.disabledByFrontmatter = false;
            this.invalidateAnalysisRun(this.activeView?.file?.path ?? null);
            this.clearProseLinterHighlights(this.activeView?.file?.path);
            this.clearHighlights();
            this.emitUpdate(false);
            return;
        }

        try {
            const activeView = this.activeView;
            const file = activeView.file;
            if (!file) {
                this.latestAnalysis = null;
                this.invalidateAnalysisRun(null);
                this.clearHighlights();
                this.emitUpdate(false);
                return;
            }
            const runStartToken = this.startAnalysisRun(file.path);

            const content = activeView.editor?.getValue() ?? await this.plugin.app.vault.cachedRead(file);
            const candidateToken = createAnalysisRunToken(file.path, hashContent(content), runStartToken.sequence);
            this.clearStaleProseLinterHighlights(candidateToken);
            if (this.isCandidateRunStale(candidateToken, content)) {
                return;
            }

            this.disabledByFrontmatter = hasWritingAnalysisOptOut(content);
            if (this.disabledByFrontmatter) {
                this.latestAnalysis = null;
                this.activeRunToken = candidateToken;
                this.clearHighlights();
                this.emitUpdate(true);
                return;
            }

            this.latestAnalysis = analyzeWriting(content, {
                longSentenceThreshold: this.plugin.settings.writingAnalysis.longSentenceThreshold,
                veryLongSentenceThreshold: this.plugin.settings.writingAnalysis.veryLongSentenceThreshold
            });
            if (this.isCandidateRunStale(candidateToken, content)) {
                return;
            }

            this.activeRunToken = candidateToken;
            this.applyHighlights();
            this.emitUpdate(true);
        } catch (error) {
            this.logger.error('Failed to analyze writing:', error);
        }
    }

    private emitUpdate(eligible: boolean): void {
        document.dispatchEvent(new CustomEvent(WRITING_ANALYSIS_UPDATED_EVENT, {
            detail: {
                analysis: this.latestAnalysis,
                filePath: this.activeView?.file?.path ?? null,
                eligible,
                disabledByFrontmatter: this.disabledByFrontmatter,
                runToken: this.activeRunToken
            } satisfies WritingAnalysisUpdateDetail
        }));
    }

    private applyHighlights(): void {
        if (!this.highlightManager) {
            this.clearHighlights();
            return;
        }

        if (this.proseLinterReviewActive) {
            const proseLinterHighlights = this.getCurrentProseLinterHighlights();
            if (proseLinterHighlights) {
                this.highlightManager.updateHighlights(proseLinterHighlights);
            } else {
                this.clearHighlights();
            }
            return;
        }

        this.clearHighlights();
    }

    private createHighlight(
        lineNumber: number,
        startCh: number,
        endCh: number,
        type: WritingHighlight['type'],
        title: string
    ): WritingHighlight | null {
        const cm = this.getEditorView();
        if (!cm) {
            return null;
        }

        const oneBasedLine = lineNumber + 1;
        if (oneBasedLine < 1 || oneBasedLine > cm.state.doc.lines) {
            return null;
        }

        const line = cm.state.doc.line(oneBasedLine);
        const from = Math.max(line.from, Math.min(line.to, line.from + startCh));
        const to = Math.max(from, Math.min(line.to, line.from + endCh));

        if (to <= from) {
            return null;
        }

        return { from, to, type, title };
    }

    private clearHighlights(): void {
        this.highlightManager?.clearHighlights();
    }

    private getCurrentProseLinterHighlights(): WritingHighlight[] | null {
        if (!this.proseLinterHighlights) {
            return null;
        }

        const activeFilePath = this.activeView?.file?.path ?? null;
        const activeContent = this.activeView?.editor?.getValue() ?? null;
        if (
            !activeContent ||
            activeFilePath !== this.proseLinterHighlightFilePath ||
            hashContent(activeContent) !== this.proseLinterHighlightContentHash
        ) {
            this.proseLinterHighlights = null;
            this.proseLinterHighlightFilePath = null;
            this.proseLinterHighlightContentHash = null;
            return null;
        }

        return this.proseLinterHighlights;
    }

    private clearStaleProseLinterHighlights(candidateToken: AnalysisRunToken): void {
        if (
            this.proseLinterHighlights &&
            (
                this.proseLinterHighlightFilePath !== candidateToken.filePath ||
                this.proseLinterHighlightContentHash !== candidateToken.contentHash
            )
        ) {
            this.proseLinterHighlights = null;
            this.proseLinterHighlightFilePath = null;
            this.proseLinterHighlightContentHash = null;
        }
    }

    private isCurrentProseLinterTarget(filePath: string, contentHash: string): boolean {
        const activeFilePath = this.activeView?.file?.path ?? null;
        const activeContent = this.activeView?.editor?.getValue() ?? null;
        return Boolean(activeContent && activeFilePath === filePath && hashContent(activeContent) === contentHash);
    }

    private setupHighlightManager(): void {
        const cm = this.getEditorView();
        if (!cm) {
            this.highlightManager = null;
            return;
        }

        this.highlightManager = new CodeMirrorWritingHighlightManager(cm, this.plugin.writingAnalysisStateField);
    }

    private setupEditorListeners(): void {
        if (!this.activeView) {
            return;
        }

        const editorEl = this.activeView.containerEl.querySelector<HTMLElement>('.cm-editor');
        if (!editorEl || this.observedEditors.has(editorEl)) {
            return;
        }

        this.observedEditors.add(editorEl);
        this.plugin.registerDomEvent(editorEl, 'input', () => {
            this.scheduleAnalysis();
        });
    }

    private getEditorView(): EditorView | null {
        const editorWithCm = this.activeView?.editor as { cm?: EditorView } | undefined;
        return editorWithCm?.cm ?? null;
    }

    private isEligibleView(view: MarkdownView | null): view is MarkdownView {
        return Boolean(view?.file && view.file.extension === 'md' && view.editor);
    }

    private shouldPreserveCurrentAnalysis(): boolean {
        if (!this.activeView || !this.isEligibleView(this.activeView)) {
            return false;
        }

        // Preserve analysis for any non-document view (file explorer, search,
        // graph, Nova sidebar, etc.). Only clear when switching to the writing
        // dashboard, which has its own analysis display.
        return this.currentLeafViewType !== VIEW_TYPE_WRITING_DASHBOARD;
    }

    private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
        this.currentLeafViewType = leaf?.view.getViewType() ?? null;

        if (this.currentLeafViewType === VIEW_TYPE_PROSE_LINTER) {
            this.setProseLinterReviewActive(true);
        } else if (this.currentLeafViewType !== 'markdown') {
            this.setProseLinterReviewActive(false);
        }

        void this.refreshForActiveView(true);
    }

    private handleWorkspaceInteraction(event: Event): void {
        const clickedViewType = this.getClickedNovaViewType(event.target);
        if (clickedViewType === VIEW_TYPE_PROSE_LINTER) {
            this.setProseLinterReviewActive(true);
            this.scheduleProseLinterReviewReconcile();
            return;
        }

        if (clickedViewType === VIEW_TYPE_NOVA_SIDEBAR) {
            this.setProseLinterReviewActive(false);
        }

        this.scheduleProseLinterReviewReconcile();
    }

    private getClickedNovaViewType(target: EventTarget | null): string | null {
        if (!(target instanceof Element)) {
            return null;
        }

        const clickedSurfaceViewType = this.getNovaSurfaceViewTypeFromElement(target);
        if (clickedSurfaceViewType) {
            return clickedSurfaceViewType;
        }

        const labeledAncestorViewType = this.getNovaViewTypeFromLabeledAncestors(target);
        if (labeledAncestorViewType) {
            return labeledAncestorViewType;
        }

        const tabHeader = target.closest('.workspace-tab-header');
        if (!tabHeader) {
            return null;
        }

        const label = [
            tabHeader.getAttribute('aria-label'),
            tabHeader.getAttribute('title'),
            tabHeader.textContent
        ]
            .filter((value): value is string => Boolean(value))
            .join(' ')
            .toLowerCase();

        if (label.includes('prose linter')) {
            return VIEW_TYPE_PROSE_LINTER;
        }

        if (label.includes('nova')) {
            return VIEW_TYPE_NOVA_SIDEBAR;
        }

        return null;
    }

    private getNovaViewTypeFromLabeledAncestors(target: Element): string | null {
        let element: Element | null = target;
        let depth = 0;

        while (element && depth < 8) {
            const viewType = this.getNovaViewTypeFromLabel([
                element.getAttribute('aria-label'),
                element.getAttribute('title')
            ]);
            if (viewType) {
                return viewType;
            }

            element = element.parentElement;
            depth++;
        }

        return null;
    }

    private getNovaViewTypeFromLabel(labels: Array<string | null>): string | null {
        const label = labels
            .filter((value): value is string => Boolean(value))
            .join(' ')
            .toLowerCase();

        if (label.includes('prose linter')) {
            return VIEW_TYPE_PROSE_LINTER;
        }

        if (label === 'nova' || label.includes('nova sidebar')) {
            return VIEW_TYPE_NOVA_SIDEBAR;
        }

        return null;
    }

    private reconcileProseLinterReviewMode(): void {
        const topVisibleSurface = this.getTopVisibleNovaSurfaceViewType();
        if (topVisibleSurface === VIEW_TYPE_PROSE_LINTER) {
            this.setProseLinterReviewActive(true);
            return;
        }

        if (topVisibleSurface === VIEW_TYPE_NOVA_SIDEBAR) {
            this.setProseLinterReviewActive(false);
            return;
        }

        const visibleNovaSurface = this.getVisibleNovaSurfaceViewType();
        if (visibleNovaSurface === VIEW_TYPE_PROSE_LINTER) {
            this.setProseLinterReviewActive(true);
            return;
        }

        if (visibleNovaSurface === VIEW_TYPE_NOVA_SIDEBAR) {
            this.setProseLinterReviewActive(false);
            return;
        }

        if (this.currentLeafViewType === VIEW_TYPE_PROSE_LINTER) {
            this.setProseLinterReviewActive(true);
            return;
        }

        if (this.currentLeafViewType === VIEW_TYPE_NOVA_SIDEBAR || this.currentLeafViewType === VIEW_TYPE_WRITING_DASHBOARD) {
            this.setProseLinterReviewActive(false);
        }
    }

    private scheduleProseLinterReviewReconcile(): void {
        if (this.pendingReviewModeReconcileTimeout !== null) {
            this.timeoutManager.removeTimeout(this.pendingReviewModeReconcileTimeout);
        }

        this.pendingReviewModeReconcileTimeout = this.timeoutManager.addTimeout(() => {
            this.pendingReviewModeReconcileTimeout = null;
            this.reconcileProseLinterReviewMode();
        }, 0);
    }

    private getVisibleNovaSurfaceViewType(): string | null {
        const proseLinterVisible = this.isAnyElementVisible('.nova-prose-linter-view');
        const sidebarVisible = this.isAnyElementVisible('.nova-sidebar-container');

        if (proseLinterVisible && !sidebarVisible) {
            return VIEW_TYPE_PROSE_LINTER;
        }

        if (sidebarVisible && !proseLinterVisible) {
            return VIEW_TYPE_NOVA_SIDEBAR;
        }

        return null;
    }

    private getTopVisibleNovaSurfaceViewType(): string | null {
        const ownerDocument = this.plugin.app.workspace.containerEl?.ownerDocument ?? document;
        if (typeof ownerDocument.elementFromPoint !== 'function') {
            return null;
        }

        const ownerWindow = ownerDocument.defaultView ?? window;
        const viewportWidth = ownerDocument.documentElement.clientWidth || ownerWindow.innerWidth;
        const viewportHeight = ownerDocument.documentElement.clientHeight || ownerWindow.innerHeight;
        const samplePoints = this.getRightPaneSamplePoints(viewportWidth, viewportHeight);

        for (const point of samplePoints) {
            const topElement = ownerDocument.elementFromPoint(point.x, point.y);
            const viewType = this.getNovaSurfaceViewTypeFromElement(topElement);
            if (viewType) {
                return viewType;
            }
        }

        return null;
    }

    private getRightPaneSamplePoints(viewportWidth: number, viewportHeight: number): Array<{ x: number; y: number }> {
        const xOffsets = [80, 160, 260];
        const yPositions = [
            96,
            180,
            Math.round(viewportHeight / 2),
            Math.max(0, viewportHeight - 160)
        ];
        const points: Array<{ x: number; y: number }> = [];

        for (const xOffset of xOffsets) {
            const x = viewportWidth - xOffset;
            if (x < 0 || x > viewportWidth) {
                continue;
            }
            for (const y of yPositions) {
                if (y < 0 || y > viewportHeight) {
                    continue;
                }
                points.push({ x, y });
            }
        }

        return points;
    }

    private getNovaSurfaceViewTypeFromElement(element: Element | null): string | null {
        if (!element) {
            return null;
        }

        if (element.closest('.nova-prose-linter-view')) {
            return VIEW_TYPE_PROSE_LINTER;
        }

        if (element.closest('.nova-sidebar-container')) {
            return VIEW_TYPE_NOVA_SIDEBAR;
        }

        return null;
    }

    private isAnyElementVisible(selector: string): boolean {
        return Array.from(document.querySelectorAll(selector)).some(element => this.isElementVisible(element));
    }

    private isElementVisible(element: Element): boolean {
        const htmlElement = element as HTMLElement;
        if (htmlElement.getClientRects().length === 0) {
            return false;
        }

        const ownerWindow = element.ownerDocument.defaultView;
        if (!ownerWindow) {
            return true;
        }

        const style = ownerWindow.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    private startAnalysisRun(filePath: string | null): AnalysisRunToken {
        this.analysisSequence++;
        this.activeRunToken = createAnalysisRunToken(filePath, '', this.analysisSequence);
        return this.activeRunToken;
    }

    private invalidateAnalysisRun(filePath: string | null): void {
        this.analysisSequence++;
        this.activeRunToken = createAnalysisRunToken(filePath, '', this.analysisSequence);
    }

    private isCandidateRunStale(candidateToken: AnalysisRunToken, candidateContent: string): boolean {
        const currentFilePath = this.activeView?.file?.path ?? null;
        const currentContent = this.activeView?.editor?.getValue() ?? candidateContent;
        const currentToken = createAnalysisRunToken(currentFilePath, hashContent(currentContent), this.analysisSequence);
        return isStaleAnalysisRun(currentToken, candidateToken);
    }
}

interface IdleCallbackWindow {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
}

function requestIdleAnalysis(callback: () => void, timeoutMs: number): number {
    const w = window as unknown as IdleCallbackWindow;
    if (typeof w.requestIdleCallback === 'function') {
        return w.requestIdleCallback(callback, { timeout: timeoutMs });
    }
    // Fallback for environments without requestIdleCallback (e.g. jsdom in
    // tests). setTimeout(0) still yields a task, preserving the same ordering
    // contract the callers depend on.
    return window.setTimeout(callback, 0);
}

function cancelIdleAnalysis(handle: number): void {
    const w = window as unknown as IdleCallbackWindow;
    if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(handle);
        return;
    }
    window.clearTimeout(handle);
}
