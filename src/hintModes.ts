import type { Plugin } from 'obsidian';
import { consumeKey } from './viewUtils';

/**
 * Rules shared by the Vimium-style hint modes: `f` links, `F` headings,
 * `y` code blocks and `Y` inline code.
 *
 * Labels are typed in lowercase only, so a Shift+letter key never types one.
 * `f` and `y` are left out too, so pressing a hint key again always closes
 * its hints instead of choosing a target.
 */
const LABEL_CHARS = 'asdghjklqwertuiopzxcvbnm';

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** Dims a hint whose label no longer starts with what was typed. */
const HINT_INACTIVE_CLASS = 'vim-reading-nav-hint-inactive';

/** Single-character labels while they suffice, otherwise two-character labels. */
export function generateHintLabels(count: number): string[] {
	if (count <= LABEL_CHARS.length) return LABEL_CHARS.slice(0, count).split('');
	const labels: string[] = [];
	for (const first of LABEL_CHARS) for (const second of LABEL_CHARS) {
		labels.push(first + second);
		if (labels.length >= count) return labels;
	}
	return labels;
}

/**
 * What a keydown means while hints are showing:
 * - `modifier`: a bare modifier, such as the Shift pressed for `Shift+F`. Ignored.
 * - `shortcut`: a Ctrl, Cmd or Alt combination. Closes the hints and still runs.
 * - `held`: an auto-repeat. Swallowed, so holding a key never types or closes twice.
 * - `backspace`: removes the last typed label character.
 * - `label`: a label character.
 * - `close`: any other key, including Escape and every hint key. Closes the
 *   hints and does nothing else.
 */
export type HintKey =
	| { kind: 'modifier' | 'shortcut' | 'held' | 'backspace' | 'close' }
	| { kind: 'label'; char: string };

/** A Ctrl, Cmd or Alt combination, but not the bare modifier key itself. */
function isShortcut(evt: KeyboardEvent): boolean {
	return !MODIFIER_KEYS.has(evt.key) && (evt.ctrlKey || evt.metaKey || evt.altKey);
}

export function readHintKey(evt: KeyboardEvent): HintKey {
	if (MODIFIER_KEYS.has(evt.key)) return { kind: 'modifier' };
	if (isShortcut(evt)) return { kind: 'shortcut' };
	if (evt.repeat) return { kind: 'held' };
	if (evt.key === 'Backspace') return { kind: 'backspace' };
	if (evt.key.length === 1 && LABEL_CHARS.includes(evt.key)) return { kind: 'label', char: evt.key };
	return { kind: 'close' };
}

/**
 * A hint badge pinned to a viewport position. Every mode shares the base
 * `vim-reading-nav-hint` look; `modeClass` adds the mode's color and anchoring.
 */
export function createHintBadge(doc: Document, label: string, left: number, top: number, modeClass?: string): HTMLElement {
	const el = doc.body.createSpan({
		cls: modeClass ? `vim-reading-nav-hint ${modeClass}` : 'vim-reading-nav-hint',
		text: label.toUpperCase(),
	});
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;
	return el;
}

interface Hint<T> {
	label: string;
	target: T;
	el: HTMLElement;
}

/**
 * The hints one mode shows in one document, and the label typed so far.
 *
 * A mode decides which targets get hints and what choosing one does. The
 * overlay owns everything in between: labels, badges, typing, and closing,
 * so every mode answers keys by the same rules.
 */
export class HintOverlay<T> {
	private hints: Hint<T>[] = [];
	private typed = '';

	isShowing(): boolean {
		return this.hints.length > 0;
	}

	/** The targets behind the current hints, in label order. */
	targets(): T[] {
		return this.hints.map((hint) => hint.target);
	}

	/** Replaces any current hints with one badge per target. No targets shows nothing. */
	show(targets: readonly T[], createBadge: (label: string, target: T) => HTMLElement): void {
		this.close();
		const labels = generateHintLabels(targets.length);
		targets.forEach((target, index) => {
			const label = labels[index];
			if (label) this.hints.push({ label, target, el: createBadge(label, target) });
		});
	}

	/** Removes every badge. Does nothing when no hints are showing. */
	close(): void {
		this.hints.forEach((hint) => hint.el.remove());
		this.hints = [];
		this.typed = '';
	}

	/**
	 * Answers a keydown while hints are showing, by the rules of `HintKey`.
	 * Returns the target whose label was just completed, after the hints
	 * close; the caller then acts on it.
	 */
	handleKey(evt: KeyboardEvent): T | null {
		const key = readHintKey(evt);
		// Not consumed: the key that follows decides, e.g. Shift then F.
		if (key.kind === 'modifier') return null;
		// Not consumed, so Obsidian or the scroll bindings still run it.
		if (key.kind === 'shortcut') {
			this.close();
			return null;
		}
		consumeKey(evt);
		if (key.kind === 'label') return this.typeLabel(key.char);
		if (key.kind === 'backspace') {
			this.typed = this.typed.slice(0, -1);
			this.dimMismatches();
		} else if (key.kind === 'close') {
			this.close();
		}
		// `held` falls through: swallowed without typing or closing.
		return null;
	}

	private typeLabel(char: string): T | null {
		this.typed += char;
		const matches = this.hints.filter((hint) => hint.label.startsWith(this.typed));
		// No label starts this way: a typo closes the hints rather than waiting.
		if (matches.length === 0) {
			this.close();
			return null;
		}
		const exact = matches.find((hint) => hint.label === this.typed);
		if (exact && matches.length === 1) {
			this.close();
			return exact.target;
		}
		this.dimMismatches();
		return null;
	}

	private dimMismatches(): void {
		this.hints.forEach((hint) => hint.el.toggleClass(HINT_INACTIVE_CLASS, !hint.label.startsWith(this.typed)));
	}
}

/** A hint mode as seen by `HintModes`. */
export interface HintMode {
	isActive(doc: Document): boolean;
	/** Closes this mode's hints in `doc`. Does nothing when none are showing. */
	closeHints(doc: Document): void;
}

/**
 * The hint modes of the plugin. While one shows hints it owns every key, so
 * the others must not open on their own trigger keys.
 */
export class HintModes {
	private readonly modes: HintMode[] = [];

	add(mode: HintMode): void {
		this.modes.push(mode);
	}

	isShowing(doc: Document): boolean {
		return this.modes.some((mode) => mode.isActive(doc));
	}

	/**
	 * Closes every mode's hints on a shortcut; the shortcut itself still runs.
	 *
	 * Obsidian runs its own hotkeys (Cmd+P, Cmd+O, ...) on the window and stops
	 * them there, so they never reach a document listener. Listening in the
	 * window's capture phase sees them first.
	 */
	registerTo(plugin: Plugin, doc: Document): void {
		const win = doc.defaultView;
		if (!win) return;
		plugin.registerDomEvent(win, 'keydown', (evt: KeyboardEvent) => {
			if (isShortcut(evt)) for (const mode of this.modes) mode.closeHints(doc);
		}, true);
	}
}
