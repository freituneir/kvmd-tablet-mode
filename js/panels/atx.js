"use strict";

// ATX power controls panel

import {apiPost} from "../api.js";

export class AtxPanel {
	constructor() {
		this._powerLed = document.getElementById("atx-power-led");
		this._powerText = document.getElementById("atx-power-text");
		this._busy = false;

		let actions = {
			"atx-power-on-btn": {action: "on"},
			"atx-power-off-btn": {action: "off"},
			"atx-force-off-btn": {action: "off_hard", confirm: "Force power off? This is like unplugging the power cable."},
			"atx-reset-btn": {action: "reset"},
			"atx-force-reset-btn": {action: "reset_hard", confirm: "Force reset? This may cause data loss."},
		};

		for (let [id, config] of Object.entries(actions)) {
			let btn = document.getElementById(id);
			btn.addEventListener("click", () => {
				if (this._busy) return;
				if (config.confirm) {
					_confirm(config.confirm).then(ok => {
						if (ok) this._doAction(config.action);
					});
				} else {
					this._doAction(config.action);
				}
			});
		}
	}

	setState(ev) {
		if (!ev) {
			this._powerLed.className = "led led-gray";
			this._powerText.textContent = "Unknown";
			return;
		}
		if (ev.leds !== undefined) {
			let power = ev.leds.power;
			this._powerLed.className = "led " + (power ? "led-green" : "led-gray");
			this._powerText.textContent = power ? "On" : "Off";
		}
		if (ev.busy !== undefined) {
			this._busy = ev.busy;
		}
	}

	async _doAction(action) {
		this._busy = true;
		try {
			await apiPost("atx/power", {action: action});
		} catch (e) {
			console.error("ATX action failed:", e);
		}
		this._busy = false;
	}
}

function _confirm(text) {
	return new Promise(resolve => {
		let dialog = document.getElementById("confirm-dialog");
		let textEl = document.getElementById("confirm-text");
		let yesBtn = document.getElementById("confirm-yes");
		let noBtn = document.getElementById("confirm-no");

		textEl.textContent = text;
		dialog.classList.remove("hidden");

		let cleanup = (result) => {
			dialog.classList.add("hidden");
			yesBtn.onclick = null;
			noBtn.onclick = null;
			resolve(result);
		};

		yesBtn.onclick = () => cleanup(true);
		noBtn.onclick = () => cleanup(false);
	});
}
