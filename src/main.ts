import { Plugin } from 'obsidian';
import { CursorManager } from './cursorManager';
import { LinkHintHandler } from './linkHintHandler';
import { ReadingModeSearchHandler } from './searchHandler';
import { HeadingFoldHintHandler } from './headingFoldHintHandler';
import { ReadingModeScrollHandler } from './scrollHandler';
import { ReadingFocus } from './readingFocus';
import { DEFAULT_SETTINGS, normalizeReadingFocusSettings, VimReadingNavSettingTab } from './settings';
import type { VimReadingNavSettings } from './settings';

export default class VimReadingNavPlugin extends Plugin {
	settings: VimReadingNavSettings = { ...DEFAULT_SETTINGS };
	private linkHints: LinkHintHandler | null = null;
	private scrollHandler: ReadingModeScrollHandler | null = null;
	private searchHandler: ReadingModeSearchHandler | null = null;
	private readingFocus: ReadingFocus | null = null;

	private headingFoldHints: HeadingFoldHintHandler | null = null;
	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new VimReadingNavSettingTab(this));

		const readingFocus = new ReadingFocus(this, this.settings);
		readingFocus.register();
		this.readingFocus = readingFocus;
		this.addCommand({
			id: 'toggle-reading-focus',
			name: 'Toggle reading focus',
			callback: () => readingFocus.toggle(),
		});

		this.linkHints = new LinkHintHandler(this);
		this.linkHints.register();
		this.scrollHandler = new ReadingModeScrollHandler(this, this.settings);
		this.headingFoldHints = new HeadingFoldHintHandler(this);
		this.headingFoldHints.register();
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
		normalizeReadingFocusSettings(this.settings);
	}

	async saveSettings(): Promise<void> {
		this.linkHints?.settingsChanged();
		normalizeReadingFocusSettings(this.settings);
		this.readingFocus?.settingsChanged();
		await this.saveData(this.settings);
	}

	onunload(): void {
		// registerDomEvent removes listeners automatically, but hint overlays
		// live on a document body and must be torn down explicitly.
		this.linkHints?.cleanup();
		this.headingFoldHints?.cleanup();
	}

	private registerForDocument(doc: Document): void {
		// Register hint handlers before scrolling so active hint input consumes keys.
		this.headingFoldHints?.registerTo(doc);
		this.linkHints?.registerTo(doc);
		this.scrollHandler?.registerTo(doc);
		this.searchHandler?.registerTo(doc);
		this.readingFocus?.registerTo(doc);
	}
}
