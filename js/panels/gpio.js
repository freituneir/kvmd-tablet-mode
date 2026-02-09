"use strict";

// GPIO controls panel — supports both output (switch) and input (read-only indicator) channels

import {apiPost} from "../api.js";

export class GpioPanel {
	constructor() {
		this._container = document.getElementById("gpio-channels");
		this._channels = {};
	}

	setState(ev) {
		if (!ev) {
			this._container.innerHTML = '<p class="text-muted">No GPIO data available.</p>';
			return;
		}

		if (ev.model) {
			this._buildChannels(ev.model);
		}

		if (ev.state) {
			for (let [channel, state] of Object.entries(ev.state)) {
				let el = this._channels[channel];
				if (el) {
					if (el.type === "switch") {
						el.element.classList.toggle("on", state);
					} else if (el.type === "indicator") {
						el.element.classList.toggle("on", state);
						let stateText = el.element.querySelector(".gpio-state-text");
						if (stateText) {
							stateText.textContent = state ? "On" : "Off";
						}
					}
				}
			}
		}
	}

	_buildChannels(model) {
		this._container.innerHTML = "";
		this._channels = {};

		if (!model.table || model.table.length === 0) {
			this._container.innerHTML = '<p class="text-muted">No GPIO channels configured.</p>';
			return;
		}

		for (let row of model.table) {
			for (let item of row) {
				if (item.type === "output") {
					let rowEl = document.createElement("div");
					rowEl.className = "gpio-row";

					let label = document.createElement("span");
					label.className = "gpio-label";
					label.textContent = item.title || item.channel;

					let sw = document.createElement("div");
					sw.className = "gpio-switch";
					sw.addEventListener("click", () => {
						apiPost("gpio/switch", {channel: item.channel, state: sw.classList.contains("on") ? 0 : 1})
							.catch(e => console.error("GPIO switch failed:", e));
					});

					this._channels[item.channel] = {type: "switch", element: sw};
					rowEl.appendChild(label);
					rowEl.appendChild(sw);
					this._container.appendChild(rowEl);
				} else if (item.type === "input") {
					let rowEl = document.createElement("div");
					rowEl.className = "gpio-row";

					let label = document.createElement("span");
					label.className = "gpio-label";
					label.textContent = item.title || item.channel;

					let indicator = document.createElement("div");
					indicator.className = "gpio-indicator";

					let dot = document.createElement("span");
					dot.className = "gpio-dot";
					indicator.appendChild(dot);

					let stateText = document.createElement("span");
					stateText.className = "gpio-state-text";
					stateText.textContent = "Off";
					indicator.appendChild(stateText);

					this._channels[item.channel] = {
						type: "indicator",
						element: indicator,
					};

					rowEl.appendChild(label);
					rowEl.appendChild(indicator);
					this._container.appendChild(rowEl);
				}
			}
		}

		if (Object.keys(this._channels).length === 0) {
			this._container.innerHTML = '<p class="text-muted">No GPIO channels configured.</p>';
		}
	}
}
