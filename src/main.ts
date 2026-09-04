import { Plugin } from 'obsidian';
import { CursorManager } from './cursorManager';
import { LinkHintHandler } from './linkHintHandler';
import { ReadingModeSearchHandler } from './searchHandler';
import { ReadingModeScrollHandler } from './scrollHandler';
import { DEFAULT_SETTINGS, VimReadingNavSettingTab } from './settings';
import type { VimReadingNavSettings } from './settings';

export default class VimReadingNavPlugin extends Plugin {
	settings: VimReadingNavSettings = { ...DEFAULT_SETTINGS };
	private linkHints: LinkHintHandler | null = null;
	private scrollHandler: ReadingModeScrollHandler | null = null;
	private searchHandler: ReadingModeSearchHandler | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new VimReadingNavSettingTab(this));

		this.linkHints = new LinkHintHandler(this);
		this.linkHints.register();
		this.scrollHandler = new ReadingModeScrollHandler(this, this.settings);
		new CursorManager(this).register();

		this.searchHandler = new ReadingModeSearchHandler(this);
		// Attach DOM listeners to the main window, every pop-out window that
		// is already open (plugin enabled mid-session), and every pop-out
		// opened later.
		const docs = new Set<Document>([document]);
		this.app.workspace.iterateAllLeaves((leaf) => {
			docs.add(leaf.view.containerEl.ownerDocument);
		});
		docs.forEach((doc) => this.registerForDocument(doc));

		this.registerEvent(
			this.app.workspace.on('window-open', (win) => this.registerForDocument(win.doc))
		);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<VimReadingNavSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	onunload(): void {
		// registerDomEvent removes listeners automatically, but hint overlays
		// live on a document body and must be torn down explicitly.
		this.linkHints?.cleanup();
	}

	private registerForDocument(doc: Document): void {
		// Register the link hint handler first so its keydown listener runs
		// before the scroll handler and can stop propagation while hint mode
		// is active (otherwise hint chars like 'j'/'k' would also scroll).
		this.linkHints?.registerTo(doc);
		this.scrollHandler?.registerTo(doc);
		this.searchHandler?.registerTo(doc);
	}
}
