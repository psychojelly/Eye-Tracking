/**
 * GazeCursor — Gaze cursor rendering with EMA smoothing and saccade detection.
 */
const GazeCursor = (function () {
    const ALPHA = 0.3;
    const BUFFER_SIZE = 5;
    const SACCADE_THRESHOLD = 200; // px

    let el = null;
    let smoothX = null;
    let smoothY = null;
    let buffer = [];
    let visible = false;

    function init() {
        el = document.getElementById('gaze-cursor');
    }

    function show() {
        if (!el) return;
        el.style.display = 'block';
        el.classList.remove('dimmed');
        visible = true;
    }

    function hide() {
        if (!el) return;
        el.style.display = 'none';
        visible = false;
    }

    function dim() {
        if (!el) return;
        el.classList.add('dimmed');
    }

    function undim() {
        if (!el) return;
        el.classList.remove('dimmed');
    }

    function update(rawX, rawY) {
        if (!el || !visible) return;

        // Clamp to viewport
        const x = Math.max(0, Math.min(rawX, window.innerWidth));
        const y = Math.max(0, Math.min(rawY, window.innerHeight));

        // First data point — snap immediately
        if (smoothX === null) {
            smoothX = x;
            smoothY = y;
            buffer = [{ x, y }];
            moveTo(smoothX, smoothY);
            return;
        }

        // Saccade detection: large jump → snap
        const dx = x - smoothX;
        const dy = y - smoothY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > SACCADE_THRESHOLD) {
            smoothX = x;
            smoothY = y;
            buffer = [{ x, y }];
            moveTo(smoothX, smoothY);
            return;
        }

        // Ring buffer
        buffer.push({ x, y });
        if (buffer.length > BUFFER_SIZE) {
            buffer.shift();
        }

        // Average of buffer
        let avgX = 0, avgY = 0;
        for (const pt of buffer) {
            avgX += pt.x;
            avgY += pt.y;
        }
        avgX /= buffer.length;
        avgY /= buffer.length;

        // EMA on the averaged value
        smoothX = smoothX + ALPHA * (avgX - smoothX);
        smoothY = smoothY + ALPHA * (avgY - smoothY);

        moveTo(smoothX, smoothY);
    }

    function moveTo(x, y) {
        el.style.left = x + 'px';
        el.style.top = y + 'px';
    }

    function reset() {
        smoothX = null;
        smoothY = null;
        buffer = [];
    }

    return { init, show, hide, dim, undim, update, reset };
})();
