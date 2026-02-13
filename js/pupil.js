/**
 * PupilTracker — Real-time relative pupil size estimation using webcam video
 * and FaceMesh landmarks from WebGazer's tracker.
 *
 * Pipeline (every ~100ms):
 * 1. Draw video frame to offscreen canvas
 * 2. Get FaceMesh landmarks via webgazer.getTracker().getPositions()
 * 3. Compute eye bounding boxes from landmark indices
 * 4. Extract eye region pixels, apply adaptive grayscale thresholding
 * 5. Compute dark-pixel ratio → relative pupil size
 * 6. Smooth with EMA, notify listeners
 */
const PupilTracker = (function () {
    // ── FaceMesh 468-point eye landmark indices ──
    const LEFT_EYE = { outerCorner: 33, innerCorner: 133, top: 159, bottom: 145 };
    const RIGHT_EYE = { outerCorner: 263, innerCorner: 362, top: 386, bottom: 374 };

    // ── Tuning constants ──
    const SAMPLE_INTERVAL = 100;       // ms between samples
    const EMA_ALPHA = 0.3;             // smoothing factor (0 = slow, 1 = instant)
    const THRESHOLD_FACTOR = 0.7;      // fraction of mean brightness to count as "dark"
    const MIN_EYE_SIZE = 4;            // minimum eye patch dimension in px to process
    const PADDING = 2;                 // extra pixels around eye bounding box

    // ── State ──
    let videoEl = null;
    let offCanvas = null;
    let offCtx = null;
    let intervalId = null;
    let smoothedSize = 0;
    let listeners = [];
    let running = false;

    /**
     * Start pupil tracking. Call after WebGazer has begun.
     */
    function start() {
        if (running) return;

        videoEl = document.getElementById('webgazerVideoFeed');
        if (!videoEl) {
            console.warn('PupilTracker: video element not found');
            return;
        }

        // Create offscreen canvas once
        if (!offCanvas) {
            offCanvas = document.createElement('canvas');
            offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
        }

        running = true;
        smoothedSize = 0;
        intervalId = setInterval(sample, SAMPLE_INTERVAL);
    }

    /**
     * Stop pupil tracking.
     */
    function stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        running = false;
    }

    /**
     * Core sampling function — called every SAMPLE_INTERVAL ms.
     */
    function sample() {
        if (!videoEl || videoEl.videoWidth === 0) return;

        // Get FaceMesh landmark positions from WebGazer's tracker
        var positions;
        try {
            var tracker = webgazer.getTracker();
            positions = tracker.getPositions();
        } catch (e) {
            return; // tracker not ready
        }

        if (!positions || positions.length < 468) return;

        // Size offscreen canvas to match video
        var vw = videoEl.videoWidth;
        var vh = videoEl.videoHeight;
        if (offCanvas.width !== vw || offCanvas.height !== vh) {
            offCanvas.width = vw;
            offCanvas.height = vh;
        }

        // Draw current frame
        offCtx.drawImage(videoEl, 0, 0, vw, vh);

        // Extract and measure both eyes
        var leftRatio = measureEye(positions, LEFT_EYE, vw, vh);
        var rightRatio = measureEye(positions, RIGHT_EYE, vw, vh);

        // Average valid measurements
        var ratio = null;
        if (leftRatio !== null && rightRatio !== null) {
            ratio = (leftRatio + rightRatio) / 2;
        } else if (leftRatio !== null) {
            ratio = leftRatio;
        } else if (rightRatio !== null) {
            ratio = rightRatio;
        }

        if (ratio === null) return;

        // Clamp to 0–1
        ratio = Math.max(0, Math.min(1, ratio));

        // EMA smoothing
        if (smoothedSize === 0) {
            smoothedSize = ratio;
        } else {
            smoothedSize = smoothedSize + EMA_ALPHA * (ratio - smoothedSize);
        }

        // Notify listeners
        for (var i = 0; i < listeners.length; i++) {
            listeners[i](smoothedSize);
        }
    }

    /**
     * Measure pupil dark-pixel ratio for one eye.
     * Returns a value between 0 and 1, or null if the eye region is too small.
     */
    function measureEye(positions, landmarks, videoW, videoH) {
        // Get landmark pixel coordinates
        var outerX = positions[landmarks.outerCorner][0];
        var innerX = positions[landmarks.innerCorner][0];
        var topY = positions[landmarks.top][1];
        var bottomY = positions[landmarks.bottom][1];

        // Compute bounding box with padding
        var x1 = Math.floor(Math.min(outerX, innerX) - PADDING);
        var x2 = Math.ceil(Math.max(outerX, innerX) + PADDING);
        var y1 = Math.floor(Math.min(topY, bottomY) - PADDING);
        var y2 = Math.ceil(Math.max(topY, bottomY) + PADDING);

        // Clamp to canvas bounds
        x1 = Math.max(0, x1);
        y1 = Math.max(0, y1);
        x2 = Math.min(videoW, x2);
        y2 = Math.min(videoH, y2);

        var w = x2 - x1;
        var h = y2 - y1;

        if (w < MIN_EYE_SIZE || h < MIN_EYE_SIZE) return null;

        // Extract pixel data for this eye region
        var imageData;
        try {
            imageData = offCtx.getImageData(x1, y1, w, h);
        } catch (e) {
            return null; // security error if cross-origin
        }

        return computePupilRatio(imageData);
    }

    /**
     * Compute the dark-pixel ratio from an eye patch.
     * Uses adaptive thresholding: threshold = mean_brightness * THRESHOLD_FACTOR
     */
    function computePupilRatio(imageData) {
        var data = imageData.data;
        var totalPixels = data.length / 4;

        if (totalPixels === 0) return null;

        // First pass: compute mean brightness (grayscale)
        var sumBrightness = 0;
        for (var i = 0; i < data.length; i += 4) {
            // Luminance: 0.299R + 0.587G + 0.114B
            var gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            sumBrightness += gray;
        }
        var meanBrightness = sumBrightness / totalPixels;

        // Adaptive threshold
        var threshold = meanBrightness * THRESHOLD_FACTOR;

        // Second pass: count dark pixels
        var darkCount = 0;
        for (var i = 0; i < data.length; i += 4) {
            var gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (gray < threshold) {
                darkCount++;
            }
        }

        return darkCount / totalPixels;
    }

    /**
     * Get the current smoothed relative pupil size (0.0–1.0).
     */
    function getSize() {
        return smoothedSize;
    }

    /**
     * Register a callback invoked on each new measurement.
     * Callback receives the smoothed pupil size (0.0–1.0).
     */
    function onUpdate(callback) {
        listeners.push(callback);
    }

    /**
     * Remove all update listeners.
     */
    function clearListeners() {
        listeners = [];
    }

    return { start, stop, getSize, onUpdate, clearListeners };
})();
