/**
 * Calibration — configurable calibration grid and accuracy measurement.
 */
const Calibration = (function () {
    const ACCURACY_DURATION = 5000; // ms

    let clicksRequired = 5;
    let grid = [0.1, 0.5, 0.9];

    let container = null;
    let progressEl = null;
    let points = [];
    let totalClicks = 0;
    let totalRequired = 0;
    let onCompleteCallback = null;

    /**
     * Configure calibration parameters before creating points.
     * @param {number} gridSize  — number of rows/cols (3–5)
     * @param {number} clicks    — clicks required per point (3–15)
     */
    function configure(gridSize, clicks) {
        clicksRequired = clicks;
        // Build evenly-spaced grid from 10% to 90%
        grid = [];
        for (let i = 0; i < gridSize; i++) {
            grid.push(0.1 + (0.8 * i) / (gridSize - 1));
        }
    }

    function createPoints() {
        container = document.getElementById('calibration-container');
        progressEl = document.getElementById('calibration-progress');
        container.innerHTML = '';
        points = [];
        totalClicks = 0;
        totalRequired = grid.length * grid.length * clicksRequired;

        for (const yPct of grid) {
            for (const xPct of grid) {
                const pt = document.createElement('div');
                pt.className = 'calibration-point';
                pt.dataset.clicks = '0';
                pt.dataset.required = String(clicksRequired);
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
        if (clicks >= clicksRequired) return;

        const newClicks = clicks + 1;
        pt.dataset.clicks = String(newClicks);
        totalClicks++;

        // Update color progression based on fraction complete
        var frac = newClicks / clicksRequired;
        if (newClicks >= clicksRequired) {
            pt.style.background = '#33cc33';
            pt.style.cursor = 'default';
            pt.style.pointerEvents = 'none';
            pt.style.opacity = '0.6';
        } else if (frac > 0.75) {
            pt.style.background = '#44bb44';
        } else if (frac > 0.5) {
            pt.style.background = '#aacc33';
        } else if (frac > 0.25) {
            pt.style.background = '#ccaa33';
        } else {
            pt.style.background = '#cc6633';
        }

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
            p => parseInt(p.dataset.clicks, 10) >= clicksRequired
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

    return { configure, createPoints, measureAccuracy, collectGaze, reset, setOnComplete };
})();
