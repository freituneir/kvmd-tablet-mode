"use strict";

// Zoom/pan state and CSS transform logic for the stream container.
//
// Two viewing modes:
//   - Fit-to-screen (default): stream scales to fit viewport, letterboxed
//   - 1:1 pixel mode: native resolution, pannable if larger than viewport
//
// Zoom can be toggled via the magnifying glass button OR pinch-to-zoom.
// When zoomed in:
//   - Three-finger drag = pan around the zoomed view
//   - Two-finger pinch = adjust zoom level (disambiguated from scroll via distance change)
//   - Two-finger parallel drag = scroll (handled by mouse.js, NOT intercepted here)
// When not zoomed:
//   - Two-finger pinch = zoom in (same disambiguation applies)
//   - Two-finger parallel drag = scroll (mouse.js handles it)

const PINCH_THRESHOLD = 15; // px of distance change to classify as pinch vs scroll

export class ZoomController {
	constructor(streamContainer, getResolution) {
		this._container = streamContainer;
		this._getResolution = getResolution;
		this._zoomed = false;
		this._scale = 1;
		this._translateX = 0;
		this._translateY = 0;
		this._onZoomChange = null;

		// Three-finger pan tracking
		this._panStartX = 0;
		this._panStartY = 0;
		this._panStartTX = 0;
		this._panStartTY = 0;
		this._isPanning = false;

		// Two-finger pinch tracking (active in all modes)
		this._pinchStartDist = 0;
		this._pinchStartScale = 1;
		this._isPinching = false;
		this._gestureUndecided = false;
		this._isScroll = false;
		this._undecidedMidX = 0;
		this._undecidedMidY = 0;

		this._onTouchStart = this._handleTouchStart.bind(this);
		this._onTouchMove = this._handleTouchMove.bind(this);
		this._onTouchEnd = this._handleTouchEnd.bind(this);

		// Use capture phase so we can intercept gestures before mouse handler
		this._container.addEventListener("touchstart", this._onTouchStart, {passive: false, capture: true});
		this._container.addEventListener("touchmove", this._onTouchMove, {passive: false, capture: true});
		this._container.addEventListener("touchend", this._onTouchEnd, {passive: false, capture: true});
	}

	set onZoomChange(cb) { this._onZoomChange = cb; }
	get zoomed() { return this._zoomed; }
	get scale() { return this._scale; }

	// Mouse handler checks this to yield when zoom is handling the gesture
	get isPanningOrPinching() { return this._isPanning || this._isPinching; }

	toggle() {
		if (this._zoomed) {
			this.resetZoom();
		} else {
			this.zoomToNative();
		}
	}

	zoomToNative() {
		let res = this._getResolution();
		if (!res || !res.realWidth || !res.realHeight) return;

		let viewW = this._container.offsetWidth;
		let viewH = this._container.offsetHeight;

		// Calculate scale needed for 1:1 pixel mapping
		let fitScale = Math.min(viewW / res.realWidth, viewH / res.realHeight);
		let nativeScale = 1 / fitScale;

		if (nativeScale <= 1.05) {
			return;
		}

		this._scale = nativeScale;
		this._translateX = 0;
		this._translateY = 0;
		this._zoomed = true;
		this._applyTransform();
		this._notifyChange();
	}

	resetZoom() {
		this._scale = 1;
		this._translateX = 0;
		this._translateY = 0;
		this._zoomed = false;
		this._applyTransform();
		this._notifyChange();
	}

	_handleTouchStart(ev) {
		// Three-finger pan (only when zoomed)
		if (ev.touches.length === 3 && this._zoomed) {
			let mid = _midpoint3(ev.touches[0], ev.touches[1], ev.touches[2]);
			this._panStartX = mid.x;
			this._panStartY = mid.y;
			this._panStartTX = this._translateX;
			this._panStartTY = this._translateY;
			this._isPanning = true;
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		// Two-finger gesture disambiguation (pinch vs scroll)
		if (ev.touches.length === 2) {
			let t0 = ev.touches[0];
			let t1 = ev.touches[1];
			this._pinchStartDist = _dist(t0, t1);
			this._pinchStartScale = this._scale;
			this._gestureUndecided = true;
			this._isScroll = false;
			this._isPinching = false;
			let mid = _midpoint(t0, t1);
			this._undecidedMidX = mid.x;
			this._undecidedMidY = mid.y;

			// Prevent default browser zoom but do NOT stopPropagation —
			// let mouse handler also see the touchstart for scroll setup
			ev.preventDefault();
		}
	}

	_handleTouchMove(ev) {
		// Three-finger pan
		if (ev.touches.length === 3 && this._isPanning) {
			ev.preventDefault();
			ev.stopPropagation();
			let mid = _midpoint3(ev.touches[0], ev.touches[1], ev.touches[2]);
			this._translateX = this._panStartTX + (mid.x - this._panStartX);
			this._translateY = this._panStartTY + (mid.y - this._panStartY);
			this._clampTranslation();
			this._applyTransform();
			return;
		}

		// Two-finger gesture (pinch vs scroll disambiguation)
		if (ev.touches.length !== 2) return;
		if (!this._gestureUndecided && !this._isPinching && !this._isScroll) return;

		let t0 = ev.touches[0];
		let t1 = ev.touches[1];
		let currentDist = _dist(t0, t1);
		let distChange = Math.abs(currentDist - this._pinchStartDist);

		// Still undecided — check if we can classify
		if (this._gestureUndecided) {
			if (distChange > PINCH_THRESHOLD) {
				// Distance changed → pinch
				this._gestureUndecided = false;
				this._isPinching = true;
				this._isScroll = false;
			} else {
				// Check if midpoint moved (parallel movement = scroll)
				let mid = _midpoint(t0, t1);
				let midDx = Math.abs(mid.x - this._undecidedMidX);
				let midDy = Math.abs(mid.y - this._undecidedMidY);
				if (midDx > 10 || midDy > 10) {
					// Fingers moving together → scroll
					this._gestureUndecided = false;
					this._isScroll = true;
					this._isPinching = false;
				}
			}

			if (this._gestureUndecided) {
				ev.preventDefault();
				return;
			}
		}

		// Decided as scroll — let mouse handler handle it
		if (this._isScroll) {
			return;
		}

		// Decided as pinch — adjust zoom
		if (this._isPinching) {
			ev.preventDefault();
			ev.stopPropagation();

			let ratio = currentDist / this._pinchStartDist;
			let newScale = this._pinchStartScale * ratio;

			// Clamp: minimum 1 (fit-to-screen), maximum 4x
			newScale = Math.max(1, Math.min(newScale, 4));
			this._scale = newScale;
			this._zoomed = newScale > 1.05;

			this._applyTransform();
		}
	}

	_handleTouchEnd(ev) {
		// Three-finger pan ended
		if (this._isPanning && ev.touches.length < 3) {
			this._isPanning = false;
			this._clampTranslation();
			this._applyTransform();
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		// Two-finger gesture ended
		if (ev.touches.length < 2) {
			let wasPinching = this._isPinching;

			this._isPinching = false;
			this._gestureUndecided = false;
			this._isScroll = false;

			if (wasPinching) {
				// Snap to fit if close to 1x
				if (this._scale < 1.05) {
					this.resetZoom();
				} else {
					this._clampTranslation();
					this._applyTransform();
				}
				this._notifyChange();
				ev.preventDefault();
				ev.stopPropagation();
			}
		}
	}

	_clampTranslation() {
		let viewW = this._container.offsetWidth;
		let viewH = this._container.offsetHeight;
		let maxTX = (viewW * (this._scale - 1)) / 2;
		let maxTY = (viewH * (this._scale - 1)) / 2;
		this._translateX = Math.max(-maxTX, Math.min(maxTX, this._translateX));
		this._translateY = Math.max(-maxTY, Math.min(maxTY, this._translateY));
	}

	_applyTransform() {
		if (this._scale === 1 && this._translateX === 0 && this._translateY === 0) {
			this._container.style.transform = "";
			this._container.classList.remove("zoomed");
		} else {
			this._container.style.transform =
				`scale(${this._scale}) translate(${this._translateX / this._scale}px, ${this._translateY / this._scale}px)`;
			this._container.classList.add("zoomed");
		}
	}

	_notifyChange() {
		if (this._onZoomChange) {
			this._onZoomChange(this._zoomed, this._scale);
		}
	}

	destroy() {
		this._container.removeEventListener("touchstart", this._onTouchStart, {capture: true});
		this._container.removeEventListener("touchmove", this._onTouchMove, {capture: true});
		this._container.removeEventListener("touchend", this._onTouchEnd, {capture: true});
	}
}

function _dist(t0, t1) {
	let dx = t0.clientX - t1.clientX;
	let dy = t0.clientY - t1.clientY;
	return Math.sqrt(dx * dx + dy * dy);
}

function _midpoint(t0, t1) {
	return {
		x: (t0.clientX + t1.clientX) / 2,
		y: (t0.clientY + t1.clientY) / 2,
	};
}

function _midpoint3(t0, t1, t2) {
	return {
		x: (t0.clientX + t1.clientX + t2.clientX) / 3,
		y: (t0.clientY + t1.clientY + t2.clientY) / 3,
	};
}
