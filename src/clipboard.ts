const COPIED_CLASS = 'vim-reading-nav-copied';
// A brief flash; Obsidian's own check icon on a code block's copy button stays for 1s.
const FEEDBACK_MS = 300;

/** Resolves to whether the text reached the clipboard. */
export async function writeClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.error('Vim Reading Navigation: failed to copy to the clipboard', error);
		return false;
	}
}

/** Briefly outlines the element that was just copied, one element at a time. */
export class CopyFeedback {
	private current: { el: HTMLElement; win: Window; timer: number } | null = null;

	show(el: HTMLElement): void {
		this.clear();
		const win = el.ownerDocument.defaultView;
		if (!win) return;
		el.addClass(COPIED_CLASS);
		const timer = win.setTimeout(() => {
			if (this.current?.timer === timer) this.clear();
		}, FEEDBACK_MS);
		this.current = { el, win, timer };
	}

	clear(): void {
		const current = this.current;
		if (!current) return;
		current.win.clearTimeout(current.timer);
		current.el.removeClass(COPIED_CLASS);
		this.current = null;
	}
}
