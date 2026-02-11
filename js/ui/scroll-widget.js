"use strict";

// Jog-shuttle scroll widget — a pill-shaped touch strip on the right edge.
//
// UX model: displacement from center controls scroll speed (like a jog shuttle).
// - Dead zone near center prevents accidental scrolls.
// - Past the dead zone, auto-repeat fires discrete scroll ticks.
// - Further from center → shorter interval between ticks (faster scrolling).
// - Over time, the interval also ramps down (acceleration).
// - On release, the thumb springs back to center and scrolling stops.
//
// Three presets control responsiveness:
//   Fine   — wide dead zone, slow repeat, 1 unit/tick (BIOS menus)
//   Normal — moderate settings, 2 units/tick
//   Fast   — narrow dead zone, fast repeat, 4 units/tick (long documents)

const PRESETS = {
	fine:   {deadZone: 18, firstTick: 35, minInterval: 200, units: 1},
	normal: {deadZone: 12, firstTick: 25, minInterval: 150, units: 2},
	fast:   {deadZone: 8,  firstTick: 18, minInterval: 100, units: 4},
};

const MAX_INTERVAL = 300;    // ms — slowest repeat rate (at first tick threshold)
const RAMP_DURATION = 1000;  // ms — time for time-based acceleration to reach minimum

// macOS host scroll boost — macOS applies aggressive acceleration that
// makes small infrequent HID wheel events nearly invisible.  We compensate
// by multiplying the units and sending a short burst of events per tick.
const MAC_UNIT_MULTIPLIER = 3;  // multiply preset units
const MAC_BURST_COUNT = 3;      // number of wheel events per tick
const MAC_BURST_DELAY = 10;     // ms between burst events

export class ScrollWidget {
	constructor(ws) {
		this._ws = ws;
		this._widget = document.getElementById("scroll-widget");
		this._thumb = document.getElementById("scroll-widget-thumb");

		// Preset
		this._preset = localStorage.getItem("pikvm.tablet.scrollPreset") || "normal";

		// macOS host mode (boosts scroll output to overcome macOS acceleration curve)
		this._macMode = localStorage.getItem("pikvm.tablet.macScroll") === "true";

		// Touch geometry (computed on touchstart from widget bounds)
		this._centerY = 0;
		this._trackHalf = 0;

		// Live state
		this._displacement = 0;
		this._direction = 0;   // +1 (down) or -1 (up) or 0 (dead zone)
		this._active = false;

		// Auto-repeat
		this._repeatTimer = null;
		this._repeatStartTime = 0;
		this._tickCount = 0;

		// Restore visibility
		let hidden = localStorage.getItem("pikvm.tablet.scrollWidgetHidden") === "true";
		if (hidden) {
			this._widget.classList.add("hidden");
		}

		this._onTouchStart = this._handleTouchStart.bind(this);
		this._onTouchMove = this._handleTouchMove.bind(this);
		this._onTouchEnd = this._handleTouchEnd.bind(this);

		this._widget.addEventListener("touchstart", this._onTouchStart, {passive: false});
		this._widget.addEventListener("touchmove", this._onTouchMove, {passive: false});
		this._widget.addEventListener("touchend", this._onTouchEnd, {passive: false});
		this._widget.addEventListener("touchcancel", this._onTouchEnd, {passive: false});
	}

	get preset() { return this._preset; }
	set preset(v) {
		if (PRESETS[v]) {
			this._preset = v;
			localStorage.setItem("pikvm.tablet.scrollPreset", v);
		}
	}

	// Keep setter for backwards compat — widget ignores it (presets control sensitivity)
	set scrollSensitivity(_v) {}

	get macMode() { return this._macMode; }
	set macMode(v) {
		this._macMode = !!v;
		localStorage.setItem("pikvm.tablet.macScroll", this._macMode);
	}

	get visible() { return !this._widget.classList.contains("hidden"); }

	show() {
		this._widget.classList.remove("hidden");
		localStorage.setItem("pikvm.tablet.scrollWidgetHidden", "false");
	}

	hide() {
		this._widget.classList.add("hidden");
		localStorage.setItem("pikvm.tablet.scrollWidgetHidden", "true");
	}

	toggle() {
		if (this.visible) this.hide(); else this.show();
	}

	_getPreset() {
		return PRESETS[this._preset] || PRESETS.normal;
	}

	// ── Touch handlers ──────────────────────────────────────────────

	_handleTouchStart(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		if (ev.touches.length !== 1) return;

		let rect = this._widget.getBoundingClientRect();
		this._centerY = rect.top + rect.height / 2;
		this._trackHalf = rect.height / 2 - 16; // inset from pill edges

		this._active = true;
		this._tickCount = 0;
		this._widget.classList.add("active");
		this._thumb.classList.remove("spring-back");

		this._updateFromTouch(ev.touches[0].clientY);
	}

	_handleTouchMove(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		if (!this._active || ev.touches.length < 1) return;
		this._updateFromTouch(ev.touches[0].clientY);
	}

	_handleTouchEnd(ev) {
		ev.preventDefault();
		ev.stopPropagation();
		this._active = false;
		this._displacement = 0;
		this._direction = 0;
		this._stopRepeat();

		// Spring-back to center
		this._thumb.classList.add("spring-back");
		this._thumb.style.transform = "translateY(0)";

		this._widget.classList.remove("active");
	}

	// ── Core displacement logic ─────────────────────────────────────

	_updateFromTouch(clientY) {
		let raw = clientY - this._centerY;
		let clamped = Math.max(-this._trackHalf, Math.min(this._trackHalf, raw));
		this._displacement = clamped;

		// Move thumb to follow finger
		this._thumb.classList.remove("spring-back");
		this._thumb.style.transform = "translateY(" + clamped + "px)";

		let preset = this._getPreset();
		let absDist = Math.abs(clamped);

		if (absDist < preset.deadZone) {
			// Inside dead zone — stop scrolling
			this._stopRepeat();
			this._direction = 0;
			return;
		}

		let newDir = clamped > 0 ? 1 : -1;

		// Direction reversal — reset acceleration
		if (newDir !== this._direction) {
			this._direction = newDir;
			this._tickCount = 0;
			this._stopRepeat();
		}

		// Start auto-repeat when past firstTick threshold
		if (absDist >= preset.firstTick && !this._repeatTimer) {
			this._fireTick();
			this._repeatStartTime = Date.now();
			this._scheduleNextTick();
		}
	}

	// ── Auto-repeat engine ──────────────────────────────────────────

	_computeInterval() {
		let preset = this._getPreset();
		let absDist = Math.abs(this._displacement);

		// Factor 1: displacement from center (further = faster)
		// Maps [firstTick .. trackHalf] → [MAX_INTERVAL .. minInterval]
		let range = this._trackHalf - preset.firstTick;
		let distRatio = range > 0 ? Math.min(1, (absDist - preset.firstTick) / range) : 0;
		distRatio = distRatio * distRatio; // quadratic — gentle start, fast ramp

		let distInterval = MAX_INTERVAL - distRatio * (MAX_INTERVAL - preset.minInterval);

		// Factor 2: time held (longer = faster)
		// Ramps from MAX_INTERVAL down to minInterval over RAMP_DURATION
		let elapsed = Date.now() - this._repeatStartTime;
		let timeRatio = Math.min(1, elapsed / RAMP_DURATION);
		timeRatio = timeRatio * timeRatio; // quadratic ease

		let timeInterval = MAX_INTERVAL - timeRatio * (MAX_INTERVAL - preset.minInterval);

		// Use whichever is faster (shorter interval)
		return Math.max(preset.minInterval, Math.min(distInterval, timeInterval));
	}

	_scheduleNextTick() {
		let interval = this._computeInterval();
		this._repeatTimer = setTimeout(() => {
			this._repeatTimer = null;
			if (!this._active || this._direction === 0) return;
			this._fireTick();
			this._scheduleNextTick();
		}, interval);
	}

	_stopRepeat() {
		if (this._repeatTimer) {
			clearTimeout(this._repeatTimer);
			this._repeatTimer = null;
		}
	}

	_fireTick() {
		let preset = this._getPreset();
		let units = this._direction * preset.units;

		if (this._macMode) {
			// macOS boost: multiply units and send a rapid burst of events
			let boosted = units * MAC_UNIT_MULTIPLIER;
			this._ws.sendMouseWheel(0, boosted);
			for (let i = 1; i < MAC_BURST_COUNT; i++) {
				setTimeout(() => this._ws.sendMouseWheel(0, boosted), i * MAC_BURST_DELAY);
			}
		} else {
			this._ws.sendMouseWheel(0, units);
		}
		this._tickCount++;

		// Visual feedback: glow pulse on thumb
		this._thumb.classList.remove("tick");
		void this._thumb.offsetWidth; // force reflow to restart animation
		this._thumb.classList.add("tick");

		// Haptic feedback (mobile browsers)
		if (navigator.vibrate) {
			navigator.vibrate(8);
		}
	}

	// ── Cleanup ─────────────────────────────────────────────────────

	destroy() {
		this._stopRepeat();
		this._widget.removeEventListener("touchstart", this._onTouchStart);
		this._widget.removeEventListener("touchmove", this._onTouchMove);
		this._widget.removeEventListener("touchend", this._onTouchEnd);
		this._widget.removeEventListener("touchcancel", this._onTouchEnd);
	}
}
