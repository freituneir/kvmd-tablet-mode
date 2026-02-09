"use strict";

// Admin drawer open/close and tab switching

export class DrawerUI {
	constructor() {
		this._drawer = document.getElementById("admin-drawer");
		this._overlay = document.getElementById("drawer-overlay");
		this._tabs = document.querySelectorAll(".drawer-tab");
		this._panels = document.querySelectorAll(".tab-panel");
		this._closeBtn = document.getElementById("drawer-close-btn");
		this._menuBtn = document.getElementById("menu-btn");
		this._onOpen = null;
		this._onClose = null;

		this._menuBtn.addEventListener("click", () => this.toggle());
		this._closeBtn.addEventListener("click", () => this.close());
		this._overlay.addEventListener("click", () => this.close());

		this._tabs.forEach(tab => {
			tab.addEventListener("click", () => {
				this._switchTab(tab.dataset.tab);
			});
		});
	}

	set onOpen(cb) { this._onOpen = cb; }
	set onClose(cb) { this._onClose = cb; }

	get isOpen() {
		return this._drawer.classList.contains("visible");
	}

	toggle() {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	open() {
		this._drawer.classList.remove("hidden");
		this._overlay.classList.remove("hidden");
		// Force reflow before adding visible class for animation
		this._drawer.offsetHeight;
		this._drawer.classList.add("visible");
		if (this._onOpen) this._onOpen();
	}

	close() {
		this._drawer.classList.remove("visible");
		// Wait for transition to finish before hiding
		setTimeout(() => {
			if (!this._drawer.classList.contains("visible")) {
				this._drawer.classList.add("hidden");
				this._overlay.classList.add("hidden");
			}
		}, 300);
		if (this._onClose) this._onClose();
	}

	_switchTab(tabId) {
		this._tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
		this._panels.forEach(p => {
			let id = p.id.replace("tab-", "");
			p.classList.toggle("hidden", id !== tabId);
			p.classList.toggle("active", id === tabId);
		});
	}
}
