import { Component, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import type VimReadingNavPlugin from './main';

export interface KeyBinding {
	key: string;
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	shift: boolean;
}

export interface VimReadingNavSettings {
	halfPageDown: KeyBinding | null;
	halfPageUp: KeyBinding | null;
	fullPageDown: KeyBinding | null;
	fullPageUp: KeyBinding | null;
	openExternalLinksImmediately: boolean;
}

export const DEFAULT_SETTINGS: VimReadingNavSettings = {
	halfPageDown: { key: 'd', ctrl: true, meta: false, alt: false, shift: false },
	halfPageUp: { key: 'u', ctrl: true, meta: false, alt: false, shift: false },
	fullPageDown: null,
	fullPageUp: null,
	openExternalLinksImmediately: false,
};

type BindingSetting = 'halfPageDown' | 'halfPageUp' | 'fullPageDown' | 'fullPageUp';

interface BindingDefinition {
	setting: BindingSetting;
	name: string;
	description: string;
}

const BINDINGS: BindingDefinition[] = [
	{ setting: 'halfPageDown', name: 'Half-page down', description: 'Scroll down half a page.' },
	{ setting: 'halfPageUp', name: 'Half-page up', description: 'Scroll up half a page.' },
	{ setting: 'fullPageDown', name: 'Full-page down', description: 'Scroll down a full page.' },
	{ setting: 'fullPageUp', name: 'Full-page up', description: 'Scroll up a full page.' },
];

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph']);

export function normalizeKey(key: string): string {
	return key.length === 1 ? key.toLowerCase() : key;
}

export function bindingMatchesEvent(binding: KeyBinding | null, evt: KeyboardEvent): boolean {
	return binding !== null &&
		binding.key === normalizeKey(evt.key) &&
		binding.ctrl === evt.ctrlKey &&
		binding.meta === evt.metaKey &&
		binding.alt === evt.altKey &&
		binding.shift === evt.shiftKey;
}

function bindingEquals(first: KeyBinding | null, second: KeyBinding | null): boolean {
	return first !== null && second !== null &&
		first.key === second.key &&
		first.ctrl === second.ctrl &&
		first.meta === second.meta &&
		first.alt === second.alt &&
		first.shift === second.shift;
}

function bindingFromEvent(evt: KeyboardEvent): KeyBinding | null {
	if (evt.repeat || MODIFIER_KEYS.has(evt.key)) return null;

	const key = normalizeKey(evt.key);
	if (key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey) return null;

	return { key, ctrl: evt.ctrlKey, meta: evt.metaKey, alt: evt.altKey, shift: evt.shiftKey };
}

function displayBinding(binding: KeyBinding | null): string {
	if (!binding) return 'Not set';

	const modifiers = [
		binding.ctrl ? 'Ctrl' : '',
		binding.meta ? (Platform.isMacOS ? 'Cmd' : 'Meta') : '',
		binding.alt ? 'Alt' : '',
		binding.shift ? 'Shift' : '',
	].filter(Boolean);
	return [...modifiers, binding.key].join('+');
}

export class VimReadingNavSettingTab extends PluginSettingTab {
	private recorder: Component | null = null;

	constructor(private readonly plugin: VimReadingNavPlugin) {
		super(plugin.app, plugin);
	}

	display(): void {
		this.stopRecording();
		this.containerEl.empty();
		this.containerEl.createEl('p', {
			text: 'These settings apply only to Markdown notes in reading mode.',
		});
		new Setting(this.containerEl)
			.setName('Open external links immediately')
			.setDesc('Skip destination confirmation for external links selected through hint mode.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.openExternalLinksImmediately)
				.onChange(async (value) => {
					this.plugin.settings.openExternalLinksImmediately = value;
					await this.plugin.saveSettings();
				}));
		for (const definition of BINDINGS) this.displayBinding(definition);
	}

	hide(): void {
		this.stopRecording();
		super.hide();
	}

	private displayBinding(definition: BindingDefinition): void {
		const setting = new Setting(this.containerEl)
			.setName(definition.name)
			.setDesc(definition.description);
		const valueEl = setting.controlEl.createSpan({
			text: displayBinding(this.plugin.settings[definition.setting]),
			cls: 'setting-item-description',
		});

		setting.addButton((button) => button
			.setButtonText('Record')
			.onClick(() => this.startRecording(definition.setting, valueEl)));
		setting.addButton((button) => button
			.setButtonText('Clear')
			.onClick(() => void this.updateBinding(definition.setting, null, valueEl)));
		setting.addButton((button) => button
			.setButtonText('Reset')
			.onClick(() => void this.updateBinding(definition.setting, DEFAULT_SETTINGS[definition.setting], valueEl)));
	}

	private startRecording(setting: BindingSetting, valueEl: HTMLElement): void {
		this.stopRecording();
		valueEl.setText('Press a key…');
		const recorder = new Component();
		this.recorder = recorder;
		recorder.load();
		recorder.registerDomEvent(this.containerEl.ownerDocument, 'keydown', (evt) => {
			if (evt.repeat) return;
			if (evt.key === 'Escape') {
				evt.preventDefault();
				evt.stopImmediatePropagation();
				this.stopRecording();
				valueEl.setText(displayBinding(this.plugin.settings[setting]));
				return;
			}

			const binding = bindingFromEvent(evt);
			if (!binding) {
				if (evt.key.length === 1 && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
					evt.preventDefault();
					evt.stopImmediatePropagation();
					new Notice('Printable keys require ctrl, meta, or alt.');
				}
				return;
			}

			evt.preventDefault();
			evt.stopImmediatePropagation();
			void this.updateBinding(setting, binding, valueEl);
		}, true);
	}

	private async updateBinding(
		setting: BindingSetting,
		binding: KeyBinding | null,
		valueEl: HTMLElement,
	): Promise<void> {
		if (binding) {
			const duplicate = BINDINGS.find((candidate) =>
				candidate.setting !== setting && bindingEquals(this.plugin.settings[candidate.setting], binding));
			if (duplicate) {
				new Notice(`${displayBinding(binding)} is already assigned to ${duplicate.name}.`);
				return;
			}
		}

		this.plugin.settings[setting] = binding ? { ...binding } : null;
		await this.plugin.saveSettings();
		this.stopRecording();
		valueEl.setText(displayBinding(binding));

		if (binding?.ctrl && !binding.meta && binding.key === 'f' && (Platform.isWin || Platform.isLinux)) {
			new Notice('Ctrl+F replaces Search current file in reading mode.');
		}
	}

	private stopRecording(): void {
		this.recorder?.unload();
		this.recorder = null;
	}
}
