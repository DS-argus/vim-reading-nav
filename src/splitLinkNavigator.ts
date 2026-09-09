import {
	MarkdownView,
	parseLinktext,
	resolveSubpath,
	TFile,
	WorkspaceTabs,
} from 'obsidian';
import type {
	OpenViewState,
	WorkspaceContainer,
	WorkspaceLeaf,
} from 'obsidian';
import type VimReadingNavPlugin from './main';

export type SplitOpenDirection = 'right' | 'below';

export interface ResolvedSplitTarget {
	file: TFile;
	subpath: string;
}

export type SplitOpenResult =
	| { opened: true; leaf: WorkspaceLeaf }
	| { opened: false; cancelled: boolean; error?: string };

/** Opens existing Markdown targets in currently adjacent, matching split groups. */
export class SplitLinkNavigator {

	constructor(private readonly plugin: VimReadingNavPlugin) {}

	findSourceLeaf(link: HTMLAnchorElement): WorkspaceLeaf | null {
		let result: WorkspaceLeaf | null = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (result || !(leaf.view instanceof MarkdownView) || leaf.view.getMode() !== 'preview') return;
			if (leaf.view.containerEl.ownerDocument === link.ownerDocument && leaf.view.containerEl.contains(link)) {
				result = leaf;
			}
		});
		return result;
	}

	isSourceLeafValid(leaf: WorkspaceLeaf, link: HTMLAnchorElement): boolean {
		if (!(leaf.view instanceof MarkdownView) || leaf.view.getMode() !== 'preview') return false;
		if (leaf.view.containerEl.ownerDocument !== link.ownerDocument || !leaf.view.containerEl.contains(link)) return false;
		return this.isAttached(leaf);
	}

	resolve(linktext: string, sourcePath: string): ResolvedSplitTarget | null {
		try {
			const parsed = parseLinktext(linktext);
			const sourceFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
			const file = parsed.path
				? this.plugin.app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath)
				: sourceFile instanceof TFile ? sourceFile : null;
			if (!(file instanceof TFile) || file.extension !== 'md') return null;
			if (parsed.subpath) {
				const cache = this.plugin.app.metadataCache.getFileCache(file);
				if (!cache || !resolveSubpath(cache, parsed.subpath)) return null;
			}
			return { file, subpath: parsed.subpath };
		} catch {
			return null;
		}
	}

	canSplit(linktext: string, sourcePath: string): boolean {
		return this.resolve(linktext, sourcePath) !== null;
	}

	async open(
		linktext: string,
		sourcePath: string,
		sourceLeaf: WorkspaceLeaf,
		direction: SplitOpenDirection,
		newPane: boolean,
		isCurrent: () => boolean,
	): Promise<SplitOpenResult> {
		if (!this.isCurrent(isCurrent)) return { opened: false, cancelled: true };
		const resolved = this.resolve(linktext, sourcePath);
		if (!resolved) {
			return { opened: false, cancelled: false, error: 'Could not resolve an existing Markdown target.' };
		}

		const sourceGroup = this.tabGroup(sourceLeaf);
		if (!sourceGroup) {
			return { opened: false, cancelled: false, error: 'Could not determine the source tab group.' };
		}
		let sourceContainer: WorkspaceContainer | null = null;
		try {
			sourceContainer = sourceLeaf.getContainer();
		} catch {
			return { opened: false, cancelled: false, error: 'The source pane is no longer available.' };
		}
		if (!sourceContainer) {
			return { opened: false, cancelled: false, error: 'The source pane is no longer available.' };
		}

		const adjacent = newPane ? null : this.adjacentLeaf(sourceLeaf, direction);

		const leavesBefore = this.collectLeaves();
		let targetLeaf: WorkspaceLeaf | null = null;
		let targetGroup: WorkspaceTabs | null = null;
		try {
			if (adjacent) {
				const anchor = adjacent;
				this.plugin.app.workspace.setActiveLeaf(anchor, { focus: false });
				const candidate = this.plugin.app.workspace.getLeaf('tab');
				if (leavesBefore.has(candidate)) throw new Error('The workspace did not create a new tab.');
				targetLeaf = candidate;
				targetGroup = this.tabGroup(candidate);
				if (targetGroup !== adjacent.parent) {
					throw new Error('The new tab was not created in the adjacent group.');
				}
			} else {
				const candidate = this.plugin.app.workspace.createLeafBySplit(
					sourceLeaf,
					this.workspaceDirection(direction),
				);
				if (leavesBefore.has(candidate)) throw new Error('The workspace did not create a new split leaf.');
				targetLeaf = candidate;
				targetGroup = this.tabGroup(candidate);
				if (!targetGroup || targetGroup === sourceGroup) {
					throw new Error('The workspace did not create a new tab group.');
				}
			}

			if (!targetLeaf || !targetGroup || !this.isCurrent(isCurrent)) {
				return this.cancelled(targetLeaf, sourceLeaf, leavesBefore, resolved.file);
			}
			this.plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: false });
			const viewState: OpenViewState = {
				state: { mode: 'preview' },
				active: true,
			};
			await targetLeaf.openFile(resolved.file, viewState);
			await targetLeaf.loadIfDeferred();
			if (!this.isCurrent(isCurrent)) {
				return this.cancelled(targetLeaf, sourceLeaf, leavesBefore, resolved.file);
			}
			const currentTarget = this.resolve(linktext, sourcePath);
			if (!currentTarget || currentTarget.file !== resolved.file || currentTarget.subpath !== resolved.subpath) {
				throw new Error('The linked target changed while opening.');
			}
			if (!this.isAttachedToGroup(targetLeaf, targetGroup)) {
				throw new Error('The destination tab was detached while opening.');
			}
			if (this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf !== targetLeaf) {
				return this.cancelled(targetLeaf, sourceLeaf, leavesBefore, resolved.file);
			}

			this.plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
			// Apply the destination after opening and focus have restored view state.
			// Markdown's native subpath navigation schedules scrolling with its renderer;
			// do not race it with the initial file/mode setup or a fixed-delay retry.
			if (resolved.subpath) targetLeaf.setEphemeralState({ subpath: resolved.subpath });
			return { opened: true, leaf: targetLeaf };
		} catch (error) {
			const current = this.isCurrent(isCurrent);
			const targetIsActive = targetLeaf !== null && this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf === targetLeaf;
			const stale = !current || (targetLeaf !== null && !targetIsActive);
			console.error('Vim Reading Navigation: failed to open split link', error);
			const detached = this.detachIfNew(targetLeaf, leavesBefore, resolved.file);
			if ((detached && targetIsActive) || (current && targetLeaf === null)) this.restoreSource(sourceLeaf);
			return { opened: false, cancelled: stale, error: 'Could not open the link in a split pane.' };
		}
	}


	private tabGroup(leaf: WorkspaceLeaf): WorkspaceTabs | null {
		const parent = leaf.parent;
		return parent instanceof WorkspaceTabs ? parent : null;
	}

	private workspaceDirection(direction: SplitOpenDirection): 'vertical' | 'horizontal' {
		return direction === 'right' ? 'vertical' : 'horizontal';
	}

	private adjacentLeaf(source: WorkspaceLeaf, direction: SplitOpenDirection): WorkspaceLeaf | null {
		const sourceEl = this.visibleGroupElement(source);
		if (!sourceEl) return null;
		const rect = sourceEl.getBoundingClientRect();
		let match: WorkspaceLeaf | null = null;
		let nearestGap = Infinity;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.parent === source.parent || leaf.getRoot() !== source.getRoot()
				|| leaf.getContainer() !== source.getContainer()) return;
			const el = this.visibleGroupElement(leaf);
			if (!el || el.ownerDocument !== sourceEl.ownerDocument) return;
			const candidate = el.getBoundingClientRect();
			// CSS-pixel rounding is allowed, but a partial-height/width neighbor is not.
			const aligned = direction === 'right'
				? Math.abs(candidate.top - rect.top) <= 1 && Math.abs(candidate.bottom - rect.bottom) <= 1
				: Math.abs(candidate.left - rect.left) <= 1 && Math.abs(candidate.right - rect.right) <= 1;
			const gap = direction === 'right' ? candidate.left - rect.right : candidate.top - rect.bottom;
			// A narrow resize divider may separate otherwise touching tab groups.
			if (aligned && gap >= -1 && gap <= 8 && gap < nearestGap) {
				nearestGap = gap;
				match = leaf;
			}
		});
		return match;
	}

	private visibleGroupElement(leaf: WorkspaceLeaf): HTMLElement | null {
		if (!this.tabGroup(leaf)) return null;
		const view = leaf.view.containerEl;
		if (!view.isConnected || view.getBoundingClientRect().width <= 0
			|| view.getBoundingClientRect().height <= 0) return null;
		// Measure the whole tab group, including its header, not the note content.
		const group = view.closest<HTMLElement>('.workspace-tabs');
		if (!group || group.getBoundingClientRect().width <= 0 || group.getBoundingClientRect().height <= 0) return null;
		return group;
	}

	private isAttachedToGroup(leaf: WorkspaceLeaf, group: WorkspaceTabs): boolean {
		let attached = false;
		this.plugin.app.workspace.iterateAllLeaves((candidate) => {
			if (candidate === leaf && candidate.parent === group) attached = true;
		});
		return attached;
	}

	private isAttached(leaf: WorkspaceLeaf): boolean {
		let attached = false;
		this.plugin.app.workspace.iterateAllLeaves((candidate) => {
			if (candidate === leaf) attached = true;
		});
		return attached;
	}

	private collectLeaves(): Set<WorkspaceLeaf> {
		const leaves = new Set<WorkspaceLeaf>();
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			leaves.add(leaf);
		});
		return leaves;
	}

	private detachIfNew(leaf: WorkspaceLeaf | null, previous: Set<WorkspaceLeaf>, targetFile: TFile): boolean {
		if (!leaf || previous.has(leaf) || !this.isAttached(leaf) || !this.isUnusedNewLeaf(leaf, targetFile)) return false;
		try {
			leaf.detach();
			return true;
		} catch (error) {
			console.error('Vim Reading Navigation: failed to clean up split leaf', error);
		}
		return false;
	}

	private isUnusedNewLeaf(leaf: WorkspaceLeaf, targetFile: TFile): boolean {
		try {
			const state = leaf.getViewState();
			if (state.pinned) return false;
			return state.type === 'empty' || (leaf.view instanceof MarkdownView
				&& leaf.view.getMode() === 'preview' && leaf.view.file === targetFile);
		} catch {
			return false;
		}
	}

	private restoreSource(sourceLeaf: WorkspaceLeaf): void {
		if (!this.isAttached(sourceLeaf)) return;
		try {
			this.plugin.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
		} catch (error) {
			console.error('Vim Reading Navigation: failed to restore source pane', error);
		}
	}

	private cancelled(
		targetLeaf: WorkspaceLeaf | null,
		sourceLeaf: WorkspaceLeaf,
		previous: Set<WorkspaceLeaf>,
		targetFile: TFile,
	): SplitOpenResult {
		const wasActive = targetLeaf !== null
			&& this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.leaf === targetLeaf;
		const detached = this.detachIfNew(targetLeaf, previous, targetFile);
		if (detached && wasActive) this.restoreSource(sourceLeaf);
		return { opened: false, cancelled: true };
	}

	private isCurrent(isCurrent: () => boolean): boolean {
		try {
			return isCurrent();
		} catch {
			return false;
		}
	}
}
