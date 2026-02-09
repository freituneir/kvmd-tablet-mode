"use strict";

// Zoom/pan state and CSS transform logic for the stream container.
//
// Two viewing modes:
//   - Fit-to-screen (default): stream scales to fit viewport, letterboxed
//   - 1:1 pixel mode: native resolution, pannable if larger than viewport
//
// Zoom can be toggled via the magnifying glass button OR pinch-to-zoom.
// Two-finger gesture disambiguation (pinch vs scroll/pan):
//   - Distance between fingers changes >15px → pinch (zoom)
//   - Midpoint moves >10px → scroll or pan depending on zoom state
// When zoomed in:
//   - Two-finger pinch = adjust zoom level
//   - Two-finger parallel drag = pan viewport
// When not zoomed:
//   - Two-finger pinch = zoom in
//   - Two-finger parallel drag = scroll (falls through to mouse.js)
// Three-finger touches are ignored.

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

		// Two-finger pan tracking (when zoomed)
		this._isPanning = false;
		this._panStartMidX = 0;
		this._panStartMidY = 0;
		this._panStartTX = 0;
		this._panStartTY = 0;

		// Two-finger pinch tracking (active in all modes)
		this._pinchStartDist = 0;
		this._pinchStartScale = 1;
		this._pinchStartTX = 0;
		this._pinchStartTY = 0;
		this._pinchFocalX = 0;
		this._pinchFocalY = 0;
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
		// Ignore three-or-more-finger touches
		if (ev.touches.length >= 3) return;

		// Two-finger gesture disambiguation (pinch vs scroll/pan)
		if (ev.touches.length === 2) {
			let t0 = ev.touches[0];
			let t1 = ev.touches[1];
			this._pinchStartDist = _dist(t0, t1);
			this._pinchStartScale = this._scale;
			this._pinchStartTX = this._translateX;
			this._pinchStartTY = this._translateY;
			this._gestureUndecided = true;
			this._isScroll = false;
			this._isPinching = false;
			this._isPanning = false;
			let mid = _midpoint(t0, t1);
			this._undecidedMidX = mid.x;
			this._undecidedMidY = mid.y;

			// Prevent default browser zoom but do NOT stopPropagation —
			// let mouse handler also see the touchstart for scroll setup
			ev.preventDefault();
		}
	}

	_handleTouchMove(ev) {
		// Ignore three-or-more-finger touches
		if (ev.touches.length >= 3) return;

		// Two-finger gesture (pinch vs scroll/pan disambiguation)
		if (ev.touches.length !== 2) return;
		if (!this._gestureUndecided && !this._isPinching && !this._isScroll && !this._isPanning) return;

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
				// Compute focal point (pinch midpoint) in content space
				// so we can keep it stationary as zoom changes
				let focalMid = _midpoint(t0, t1);
				let focalRect = this._container.getBoundingClientRect();
				this._pinchFocalX = (focalMid.x - focalRect.left) / this._pinchStartScale;
				this._pinchFocalY = (focalMid.y - focalRect.top) / this._pinchStartScale;
			} else {
				// Check if midpoint moved (parallel movement = scroll or pan)
				let mid = _midpoint(t0, t1);
				let midDx = Math.abs(mid.x - this._undecidedMidX);
				let midDy = Math.abs(mid.y - this._undecidedMidY);
				if (midDx > 10 || midDy > 10) {
					this._gestureUndecided = false;
					this._isPinching = false;
					if (this._zoomed) {
						// Zoomed: parallel movement = pan viewport
						this._isPanning = true;
						this._isScroll = false;
						this._panStartMidX = mid.x;
						this._panStartMidY = mid.y;
						this._panStartTX = this._translateX;
						this._panStartTY = this._translateY;
					} else {
						// Not zoomed: parallel movement = scroll (mouse.js handles)
						this._isScroll = true;
					}
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

		// Decided as pan — move the zoomed viewport
		if (this._isPanning) {
			ev.preventDefault();
			ev.stopPropagation();

			let mid = _midpoint(t0, t1);
			this._translateX = this._panStartTX + (mid.x - this._panStartMidX);
			this._translateY = this._panStartTY + (mid.y - this._panStartMidY);
			this._clampTranslation();
			this._applyTransform();
			return;
		}

		// Decided as pinch — adjust zoom around the focal point
		if (this._isPinching) {
			ev.preventDefault();
			ev.stopPropagation();

			let ratio = currentDist / this._pinchStartDist;
			let newScale = this._pinchStartScale * ratio;

			// Clamp: minimum 1 (fit-to-screen), maximum 4x
			newScale = Math.max(1, Math.min(newScale, 4));

			// Adjust translation to keep the pinch focal point stationary.
			// The focal point is in content-space coords; we shift the
			// viewport so it stays at the same screen position after scaling.
			let cx = this._container.offsetWidth / 2;
			let cy = this._container.offsetHeight / 2;
			this._translateX = this._pinchStartTX + (this._pinchFocalX - cx) * (this._pinchStartScale - newScale);
			this._translateY = this._pinchStartTY + (this._pinchFocalY - cy) * (this._pinchStartScale - newScale);

			this._scale = newScale;
			this._zoomed = newScale > 1.05;

			this._clampTranslation();
			this._applyTransform();
		}
	}

	_handleTouchEnd(ev) {
		// Two-finger gesture ended
		if (ev.touches.length < 2) {
			let wasPinching = this._isPinching;
			let wasPanning = this._isPanning;

			this._isPinching = false;
			this._isPanning = false;
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

			if (wasPanning) {
				this._clampTranslation();
				this._applyTransform();
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
