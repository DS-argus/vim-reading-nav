import { Plugin } from 'obsidian';
import { CodeCopyHintHandler } from './codeCopyHintHandler';
import { CursorManager } from './cursorManager';
import { HintModes } from './hintModes';
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
	private codeCopyHints: CodeCopyHintHandler | null = null;
	private hintModes: HintModes | null = null;

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

		const hintModes = new HintModes();
		this.hintModes = hintModes;
		this.linkHints = new LinkHintHandler(this, hintModes);
		this.linkHints.register();
		this.scrollHandler = new ReadingModeScrollHandler(this, this.settings);
		this.headingFoldHints = new HeadingFoldHintHandler(this, hintModes);
		this.headingFoldHints.register();
		this.codeCopyHints = new CodeCopyHintHandler(this, hintModes);
		this.codeCopyHints.register();
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
		this.codeCopyHints?.cleanup();
	}

	private registerForDocument(doc: Document): void {
		// Closes hints on Obsidian hotkeys. It listens on the window, ahead of every handler below.
		this.hintModes?.registerTo(this, doc);
		// Hint handlers come before scrolling, so keys typed into hints never scroll.
		// Links come first among them: a focused link takes `y` to copy itself before `y` opens code hints.
		this.linkHints?.registerTo(doc);
		this.headingFoldHints?.registerTo(doc);
		this.codeCopyHints?.registerTo(doc);
		this.scrollHandler?.registerTo(doc);
		this.searchHandler?.registerTo(doc);
		this.readingFocus?.registerTo(doc);
	}
}
