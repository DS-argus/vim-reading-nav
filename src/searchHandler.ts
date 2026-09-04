import { Plugin } from 'obsidian';
import { getPreviewViewIn, isFocusInModal } from './viewUtils';

interface CommandManager {
	executeCommandById?(id: string): boolean | void;
}

/** Maps `/` in Reading mode to Obsidian's native document search. */
export class ReadingModeSearchHandler {
	private readonly registeredDocuments = new WeakSet<Document>();

	constructor(private readonly plugin: Plugin) {}

	registerTo(doc: Document): void {
		if (this.registeredDocuments.has(doc)) return;
		this.registeredDocuments.add(doc);
		this.plugin.registerDomEvent(doc, 'keydown', (evt: KeyboardEvent) => {
			this.handleKeyDown(evt, doc);
		});
	}

	private handleKeyDown(evt: KeyboardEvent, doc: Document): void {
		if (
			evt.key !== '/' ||
			evt.ctrlKey ||
			evt.metaKey ||
			evt.altKey ||
			isFocusInModal(evt, doc) ||
			!getPreviewViewIn(this.plugin.app, doc) ||
			!this.executeOpenSearch()
		) return;

		evt.preventDefault();
		evt.stopImmediatePropagation();
	}

	private executeOpenSearch(): boolean {
		try {
			const commands = (this.plugin.app as unknown as { commands?: CommandManager }).commands;
			if (!commands?.executeCommandById) return false;
			return commands.executeCommandById('editor:open-search') !== false;
		} catch {
			return false;
		}
	}
}
