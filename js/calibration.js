/**
 * Calibration — 9-point calibration grid and accuracy measurement.
 */
const Calibration = (function () {
    const CLICKS_REQUIRED = 5;
    const GRID = [0.1, 0.5, 0.9]; // 10%, 50%, 90% of viewport
    const ACCURACY_DURATION = 5000; // ms

    let container = null;
    let progressEl = null;
    let points = [];
    let totalClicks = 0;
    let totalRequired = 0;
    let onCompleteCallback = null;

    function createPoints() {
        container = document.getElementById('calibration-container');
        progressEl = document.getElementById('calibration-progress');
        container.innerHTML = '';
        points = [];
        totalClicks = 0;
        totalRequired = GRID.length * GRID.length * CLICKS_REQUIRED;

        for (const yPct of GRID) {
            for (const xPct of GRID) {
                const pt = document.createElement('div');
                pt.className = 'calibration-point';
                pt.dataset.clicks = '0';
                pt.style.left = (xPct * 100) + '%';
                pt.style.top = (yPct * 100) + '%';

                pt.addEventListener('click', function () {
                    handlePointClick(pt);
                });

                container.appendChild(pt);
                points.push(pt);
            }
        }

        updateProgress();
    }

    function handlePointClick(pt) {
        const clicks = parseInt(pt.dataset.clicks, 10);
        if (clicks >= CLICKS_REQUIRED) return;

        const newClicks = clicks + 1;
        pt.dataset.clicks = String(newClicks);
        totalClicks++;

        updateProgress();

        // Check if all points are done
        if (totalClicks >= totalRequired) {
            if (onCompleteCallback) {
                // Small delay so the user sees the final green state
                setTimeout(onCompleteCallback, 400);
            }
        }
    }

    function updateProgress() {
        const completed = points.filter(
            p => parseInt(p.dataset.clicks, 10) >= CLICKS_REQUIRED
        ).length;
        progressEl.textContent = completed + ' / ' + points.length + ' points complete';
    }

    // Accuracy collection state — app.js gaze handler calls this
    let collecting = false;
    let collectedPoints = [];

    function collectGaze(x, y) {
        if (collecting) {
            collectedPoints.push({ x: x, y: y });
        }
    }

    function measureAccuracy(callback) {
        // Collect gaze predictions while user stares at center
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        collectedPoints = [];
        collecting = true;

        setTimeout(function () {
            collecting = false;

            if (collectedPoints.length === 0) {
                callback(0);
                return;
            }

            // Compute average distance from center
            let totalDist = 0;
            for (const p of collectedPoints) {
                const dx = p.x - cx;
                const dy = p.y - cy;
                totalDist += Math.sqrt(dx * dx + dy * dy);
            }
            const avgDist = totalDist / collectedPoints.length;

            // Convert to percentage: 0px = 100%, maxDist (half diagonal) = 0%
            const maxDist = Math.sqrt(cx * cx + cy * cy);
            const accuracy = Math.max(0, Math.round((1 - avgDist / maxDist) * 100));

            callback(accuracy);
        }, ACCURACY_DURATION);
    }

    function reset() {
        if (container) {
            container.innerHTML = '';
        }
        points = [];
        totalClicks = 0;
    }

    function setOnComplete(cb) {
        onCompleteCallback = cb;
    }

    return { createPoints, measureAccuracy, collectGaze, reset, setOnComplete };
})();
