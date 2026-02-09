"use strict";

// Floating mouse button panel with keyboard quick-access and collapse/expand toggle

export class MousePanelUI {
	constructor(mouseHandler, keyboardUI) {
		this._handler = mouseHandler;
		this._keyboardUI = keyboardUI;
		this._panel = document.getElementById("mouse-panel");
		this._buttonsWrap = document.getElementById("mouse-panel-buttons");
		this._collapseBtn = document.getElementById("mouse-panel-collapse-btn");
		this._keyboardBtn = document.getElementById("mouse-panel-keyboard-btn");
		this._collapsed = false;

		// Restore collapsed state
		if (localStorage.getItem("pikvm.tablet.mousePanelCollapsed") === "true") {
			this._setCollapsed(true);
		}

		// Mouse buttons (L, M, R)
		this._panel.querySelectorAll(".mouse-btn").forEach(btn => {
			let button = btn.dataset.button;

			btn.addEventListener("touchstart", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				btn.classList.add("active");
				this._handler.sendButton(button, true);
			}, {passive: false});

			btn.addEventListener("touchend", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				btn.classList.remove("active");
				this._handler.sendButton(button, false);
			}, {passive: false});

			// Also handle mouse events for when using with a pointer device
			btn.addEventListener("mousedown", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				btn.classList.add("active");
				this._handler.sendButton(button, true);
			});

			btn.addEventListener("mouseup", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				btn.classList.remove("active");
				this._handler.sendButton(button, false);
			});

			btn.addEventListener("mouseleave", () => {
				if (btn.classList.contains("active")) {
					btn.classList.remove("active");
					this._handler.sendButton(button, false);
				}
			});
		});

		// Keyboard quick-access button
		let kbHandler = (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			this._keyboardUI.showTextInput();
		};
		this._keyboardBtn.addEventListener("click", kbHandler);
		this._keyboardBtn.addEventListener("touchend", kbHandler, {passive: false});

		// Clipboard paste button
		let pasteBtn = document.getElementById("mouse-panel-paste-btn");
		let pasteHandler = (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			if (navigator.clipboard && navigator.clipboard.readText) {
				navigator.clipboard.readText().then(text => {
					if (text) {
						this._keyboardUI.sendTextSlow(text);
					}
				}).catch(err => {
					console.warn("Clipboard read failed:", err);
				});
			}
		};
		pasteBtn.addEventListener("click", pasteHandler);
		pasteBtn.addEventListener("touchend", pasteHandler, {passive: false});

		// Collapse/expand toggle
		let collapseHandler = (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			this._setCollapsed(!this._collapsed);
		};
		this._collapseBtn.addEventListener("click", collapseHandler);
		this._collapseBtn.addEventListener("touchend", collapseHandler, {passive: false});

		// Make panel draggable
		this._makeDraggable();
	}

	_setCollapsed(collapsed) {
		this._collapsed = collapsed;
		this._buttonsWrap.classList.toggle("hidden", collapsed);
		this._collapseBtn.innerHTML = collapsed
			? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>'
			: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
		this._collapseBtn.title = collapsed ? "Expand panel" : "Collapse panel";
		this._panel.classList.toggle("collapsed", collapsed);
		localStorage.setItem("pikvm.tablet.mousePanelCollapsed", collapsed);
	}

	_makeDraggable() {
		let startX, startY, startLeft, startBottom;
		let dragging = false;

		this._panel.addEventListener("touchstart", (ev) => {
			// Only initiate drag if touching the panel background, not buttons
			if (ev.target === this._panel) {
				ev.preventDefault();
				dragging = true;
				let touch = ev.touches[0];
				startX = touch.clientX;
				startY = touch.clientY;
				let rect = this._panel.getBoundingClientRect();
				startLeft = rect.left;
				startBottom = window.innerHeight - rect.bottom;
			}
		}, {passive: false});

		document.addEventListener("touchmove", (ev) => {
			if (!dragging) return;
			let touch = ev.touches[0];
			let dx = touch.clientX - startX;
			let dy = touch.clientY - startY;
			this._panel.style.right = "auto";
			this._panel.style.left = (startLeft + dx) + "px";
			this._panel.style.bottom = (startBottom - dy) + "px";
		}, {passive: true});

		document.addEventListener("touchend", () => {
			dragging = false;
		});
	}
}
