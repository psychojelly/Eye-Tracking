/**
 * App — Main orchestrator: WebGazer lifecycle, screen transitions, error handling.
 */
(function () {
    // ── Screen references ──
    const screens = {
        welcome: document.getElementById('screen-welcome'),
        calibration: document.getElementById('screen-calibration'),
        depthCal: document.getElementById('screen-depth-cal'),
        accuracy: document.getElementById('screen-accuracy'),
        tracking: document.getElementById('screen-tracking'),
    };

    // ── Element references ──
    const btnStart = document.getElementById('btn-start');
    const errorDisplay = document.getElementById('error-display');
    const btnRecalibrate = document.getElementById('btn-recalibrate');
    const btnContinue = document.getElementById('btn-continue');
    const btnRecalibrateTracking = document.getElementById('btn-recalibrate-tracking');
    const btnToggleVideo = document.getElementById('btn-toggle-video');
    const btnFlipVideo = document.getElementById('btn-flip-video');
    const btnFlipTrackingX = document.getElementById('btn-flip-tracking-x');
    const btnFlipTrackingY = document.getElementById('btn-flip-tracking-y');
    const accuracyInstruction = document.getElementById('accuracy-instruction');
    const accuracyResult = document.getElementById('accuracy-result');
    const accuracyValue = document.getElementById('accuracy-value');
    const resizeWarning = document.getElementById('resize-warning');

    const pupilHud = document.getElementById('pupil-hud');
    const pupilLabel = document.getElementById('pupil-label');
    const pupilBarFill = document.getElementById('pupil-bar-fill');

    // ── Settings controls ──
    const settingGrid = document.getElementById('setting-grid');
    const settingGridLabel = document.getElementById('setting-grid-label');
    const settingClicks = document.getElementById('setting-clicks');
    const settingClicksLabel = document.getElementById('setting-clicks-label');
    const settingDepth = document.getElementById('setting-depth');

    let currentScreen = 'welcome';
    let nullGazeTimer = null;
    let videoVisible = true;
    let resizeTimeout = null;

    // ── Settings GUI ──
    function updateGridLabel() {
        var n = settingGrid.value;
        settingGridLabel.textContent = n + ' x ' + n + ' (' + (n * n) + ' pts)';
    }

    function updateClicksLabel() {
        settingClicksLabel.textContent = settingClicks.value;
    }

    settingGrid.addEventListener('input', updateGridLabel);
    settingClicks.addEventListener('input', updateClicksLabel);

    // Initialize labels
    updateGridLabel();
    updateClicksLabel();

    // ── HTTPS / localhost check ──
    function checkSecureContext() {
        if (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
            return true;
        }
        showError('Camera access requires HTTPS or localhost. Please serve this page over a secure connection.');
        return false;
    }

    // ── Screen transitions ──
    function showScreen(name) {
        for (const key in screens) {
            screens[key].classList.remove('active');
            screens[key].classList.add('hidden');
        }
        screens[name].classList.remove('hidden');
        screens[name].classList.add('active');
        currentScreen = name;
    }

    // ── Error display ──
    function showError(msg) {
        errorDisplay.textContent = msg;
        errorDisplay.classList.remove('hidden');
    }

    function hideError() {
        errorDisplay.classList.add('hidden');
        errorDisplay.textContent = '';
    }

    // ── Camera error messages ──
    function cameraErrorMessage(err) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            return 'Camera permission was denied. Please allow camera access in your browser settings and reload.';
        }
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            return 'No camera found. Please connect a webcam and reload.';
        }
        if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            return 'Camera is in use by another application. Close other apps using the camera and try again.';
        }
        if (err.name === 'OverconstrainedError') {
            return 'Camera does not meet the required constraints. Try a different camera.';
        }
        return 'Could not access the camera: ' + (err.message || err.name || 'Unknown error');
    }

    // ── WebGazer initialization ──
    async function initWebGazer() {
        btnStart.disabled = true;
        btnStart.textContent = 'Starting...';
        hideError();

        try {
            // Configure individually to avoid chain breakage
            webgazer.setRegression('ridge');
            webgazer.saveDataAcrossSessions(false);
            webgazer.applyKalmanFilter(true);
            webgazer.showPredictionPoints(false);

            // Set gaze listener BEFORE begin so predictions are captured immediately
            webgazer.setGazeListener(function (data, timestamp) {
                if (data == null) {
                    handleNullGaze();
                    return;
                }
                handleGaze(data.x, data.y);
            });

            await webgazer.begin();

            // Configure video display after begin (elements exist now)
            webgazer.showVideo(true);
            webgazer.showFaceOverlay(true);
            webgazer.showFaceFeedbackBox(true);

            // Apply default video flip
            applyVideoFlip();

            // Transition to calibration
            startCalibration();
        } catch (err) {
            console.error('WebGazer init error:', err);
            btnStart.disabled = false;
            btnStart.textContent = 'Start Camera';
            showError(cameraErrorMessage(err));
        }
    }

    // ── Gaze handling ──
    function handleGaze(x, y) {
        // Clear null-gaze timer
        if (nullGazeTimer) {
            clearTimeout(nullGazeTimer);
            nullGazeTimer = null;
            GazeCursor.undim();
        }

        // Apply head pose correction only during live tracking
        if (currentScreen === 'tracking' && HeadPoseTracker.isActive()) {
            var offset = HeadPoseTracker.getOffset();
            x += offset.x;
            y += offset.y;
        }

        GazeCursor.update(x, y);
        // Feed data to accuracy measurement if collecting
        Calibration.collectGaze(x, y);
    }

    function handleNullGaze() {
        if (!nullGazeTimer) {
            nullGazeTimer = setTimeout(function () {
                GazeCursor.dim();
            }, 1500);
        }
    }

    // ── Show/hide WebGazer video elements ──
    function setVideoVisible(show) {
        var els = [
            document.getElementById('webgazerVideoContainer'),
            document.getElementById('webgazerVideoFeed'),
            document.getElementById('webgazerVideoCanvas'),
            document.getElementById('webgazerFaceOverlay'),
            document.getElementById('webgazerFaceFeedbackBox'),
        ];
        var display = show ? '' : 'none';
        for (var i = 0; i < els.length; i++) {
            if (els[i]) els[i].style.display = display;
        }
    }

    // ── Calibration flow ──
    function startCalibration() {
        showScreen('calibration');
        PupilTracker.stop();
        HeadPoseTracker.reset();
        pupilHud.classList.add('hidden');
        GazeCursor.hide();
        setVideoVisible(false); // Hide video so it doesn't block calibration points

        // Apply user settings
        var gridSize = parseInt(settingGrid.value, 10);
        var clicks = parseInt(settingClicks.value, 10);
        Calibration.configure(gridSize, clicks);

        Calibration.reset();
        Calibration.createPoints();
        Calibration.setOnComplete(function () {
            HeadPoseTracker.captureReference();
            if (settingDepth.checked) {
                startDepthCalibration();
            } else {
                startAccuracyTest();
            }
        });
    }

    // ── Depth calibration flow ──
    var depthCalState = null;
    var depthDistanceInterval = null;
    var depthRefInterEyeDist = null;

    // 5 positions: center + 4 corners
    var DEPTH_POSITIONS = [
        { x: 0.5, y: 0.5 },
        { x: 0.15, y: 0.15 },
        { x: 0.85, y: 0.15 },
        { x: 0.15, y: 0.85 },
        { x: 0.85, y: 0.85 },
    ];
    var DEPTH_CLICKS_PER_DISTANCE = 3;
    // Phases: closer, farther
    var DEPTH_PHASES = ['closer', 'farther'];

    function startDepthCalibration() {
        showScreen('depthCal');
        setVideoVisible(true); // Show video so user can see themselves leaning
        applyVideoFlip();
        GazeCursor.hide();

        // Capture reference distance for the indicator
        depthRefInterEyeDist = getInterEyeDist();

        depthCalState = {
            posIndex: 0,
            phaseIndex: 0,
            clicks: 0,
            totalSteps: DEPTH_POSITIONS.length * DEPTH_PHASES.length,
            currentStep: 0,
        };

        showDepthPoint();
        startDepthDistanceHud();
    }

    function showDepthPoint() {
        var container = document.getElementById('depth-cal-container');
        var instruction = document.getElementById('depth-cal-instruction');
        var progress = document.getElementById('depth-cal-progress');
        container.innerHTML = '';

        var pos = DEPTH_POSITIONS[depthCalState.posIndex];
        var phase = DEPTH_PHASES[depthCalState.phaseIndex];

        if (phase === 'closer') {
            instruction.textContent = 'Lean CLOSER to the screen and click the point ' + DEPTH_CLICKS_PER_DISTANCE + ' times';
        } else {
            instruction.textContent = 'Lean FARTHER from the screen and click the point ' + DEPTH_CLICKS_PER_DISTANCE + ' times';
        }

        depthCalState.currentStep = depthCalState.posIndex * DEPTH_PHASES.length + depthCalState.phaseIndex;
        progress.textContent = (depthCalState.currentStep + 1) + ' / ' + depthCalState.totalSteps + ' steps';

        var pt = document.createElement('div');
        pt.className = 'calibration-point depth-cal-point';
        pt.style.left = (pos.x * 100) + '%';
        pt.style.top = (pos.y * 100) + '%';
        pt.style.background = phase === 'closer' ? '#ff9944' : '#44aaff';
        pt.style.width = '36px';
        pt.style.height = '36px';

        pt.addEventListener('click', function () {
            handleDepthClick(pt);
        });

        container.appendChild(pt);
    }

    function handleDepthClick(pt) {
        depthCalState.clicks++;

        // Visual feedback
        var frac = depthCalState.clicks / DEPTH_CLICKS_PER_DISTANCE;
        if (frac >= 1) {
            pt.style.background = '#33cc33';
            pt.style.pointerEvents = 'none';
            pt.style.opacity = '0.6';
        } else {
            var phase = DEPTH_PHASES[depthCalState.phaseIndex];
            if (phase === 'closer') {
                pt.style.background = frac > 0.5 ? '#ccaa33' : '#ff9944';
            } else {
                pt.style.background = frac > 0.5 ? '#44bb88' : '#44aaff';
            }
        }

        if (depthCalState.clicks >= DEPTH_CLICKS_PER_DISTANCE) {
            // Move to next phase or position
            depthCalState.clicks = 0;
            depthCalState.phaseIndex++;

            if (depthCalState.phaseIndex >= DEPTH_PHASES.length) {
                depthCalState.phaseIndex = 0;
                depthCalState.posIndex++;

                if (depthCalState.posIndex >= DEPTH_POSITIONS.length) {
                    // Depth calibration complete
                    finishDepthCalibration();
                    return;
                }
            }

            setTimeout(showDepthPoint, 300);
        }
    }

    function finishDepthCalibration() {
        stopDepthDistanceHud();
        // Re-capture reference at normal sitting distance, mark Z range as trained
        HeadPoseTracker.captureReference();
        HeadPoseTracker.markDepthCalibrated();
        startAccuracyTest();
    }

    function getInterEyeDist() {
        try {
            var tracker = webgazer.getTracker();
            var positions = tracker.getPositions();
            if (!positions || positions.length < 468) return null;
            var l = positions[33]; // left eye outer
            var r = positions[263]; // right eye outer
            var dx = l[0] - r[0];
            var dy = l[1] - r[1];
            return Math.sqrt(dx * dx + dy * dy);
        } catch (e) {
            return null;
        }
    }

    function startDepthDistanceHud() {
        var label = document.getElementById('depth-distance-label');
        var fill = document.getElementById('depth-bar-fill');
        var marker = document.getElementById('depth-bar-marker');

        depthDistanceInterval = setInterval(function () {
            var dist = getInterEyeDist();
            if (dist === null || depthRefInterEyeDist === null) return;

            // Ratio: >1 means closer, <1 means farther
            var ratio = dist / depthRefInterEyeDist;
            // Map to 0-100 range: 0.7 ratio = 0%, 1.0 = 50%, 1.3 = 100%
            var pct = Math.max(0, Math.min(100, ((ratio - 0.7) / 0.6) * 100));

            if (ratio > 1.05) {
                label.textContent = 'Distance: Closer';
            } else if (ratio < 0.95) {
                label.textContent = 'Distance: Farther';
            } else {
                label.textContent = 'Distance: Normal';
            }

            fill.style.width = pct + '%';
            marker.style.left = '50%'; // normal position marker
        }, 100);
    }

    function stopDepthDistanceHud() {
        if (depthDistanceInterval) {
            clearInterval(depthDistanceInterval);
            depthDistanceInterval = null;
        }
    }

    // ── Accuracy test flow ──
    function startAccuracyTest() {
        showScreen('accuracy');
        accuracyResult.classList.add('hidden');
        accuracyInstruction.classList.remove('hidden');
        accuracyInstruction.textContent = 'Stare at the dot in the center for 5 seconds...';
        GazeCursor.hide();

        // Small delay so user can focus on the dot
        setTimeout(function () {
            Calibration.measureAccuracy(function (accuracy) {
                accuracyInstruction.classList.add('hidden');
                accuracyResult.classList.remove('hidden');
                accuracyValue.textContent = accuracy;
            });
        }, 1000);
    }

    // ── Live tracking ──
    function startTracking() {
        showScreen('tracking');
        setVideoVisible(videoVisible);
        GazeCursor.reset();
        GazeCursor.show();
        resizeWarning.classList.add('hidden');
        pupilHud.classList.remove('hidden');
        PupilTracker.start();
    }

    // ── Video toggle ──
    function toggleVideo() {
        videoVisible = !videoVisible;
        setVideoVisible(videoVisible);
    }

    // ── Resize handling ──
    function handleResize() {
        if (currentScreen === 'tracking') {
            resizeWarning.classList.remove('hidden');
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function () {
                // Keep warning visible until recalibration
            }, 500);
        }
    }

    // ── Event listeners ──
    btnStart.addEventListener('click', function () {
        if (!checkSecureContext()) return;
        initWebGazer();
    });

    btnRecalibrate.addEventListener('click', function () {
        // Clear WebGazer training data and recalibrate
        webgazer.clearData();
        HeadPoseTracker.reset();
        startCalibration();
    });

    btnContinue.addEventListener('click', function () {
        startTracking();
    });

    btnRecalibrateTracking.addEventListener('click', function () {
        GazeCursor.hide();
        webgazer.clearData();
        HeadPoseTracker.reset();
        startCalibration();
    });

    btnToggleVideo.addEventListener('click', toggleVideo);

    // ── Flip video (visual mirror) — default: flipped ──
    let videoFlipped = true;
    function applyVideoFlip() {
        var els = [
            document.getElementById('webgazerVideoFeed'),
            document.getElementById('webgazerVideoCanvas'),
            document.getElementById('webgazerFaceOverlay'),
        ];
        for (var i = 0; i < els.length; i++) {
            if (els[i]) els[i].style.transform = videoFlipped ? 'scaleX(-1)' : '';
        }
        btnFlipVideo.textContent = videoFlipped ? 'Flip Video (flipped)' : 'Flip Video';
    }
    btnFlipVideo.addEventListener('click', function () {
        videoFlipped = !videoFlipped;
        applyVideoFlip();
    });

    // ── Flip head tracking axes ── (X defaults to flipped in headpose.js)
    btnFlipTrackingX.textContent = 'Flip Tracking X (flipped)';

    btnFlipTrackingX.addEventListener('click', function () {
        var sign = HeadPoseTracker.toggleFlipX();
        btnFlipTrackingX.textContent = sign < 0 ? 'Flip Tracking X (flipped)' : 'Flip Tracking X';
    });

    btnFlipTrackingY.addEventListener('click', function () {
        var sign = HeadPoseTracker.toggleFlipY();
        btnFlipTrackingY.textContent = sign < 0 ? 'Flip Tracking Y (flipped)' : 'Flip Tracking Y';
    });

    window.addEventListener('resize', handleResize);

    // ── Cleanup ──
    window.addEventListener('beforeunload', function () {
        if (typeof webgazer !== 'undefined') {
            try {
                webgazer.end();
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    });

    // ── Init ──
    GazeCursor.init();

    // Wire pupil tracker updates to HUD
    PupilTracker.onUpdate(function (size) {
        var pct = Math.round(size * 100);
        pupilLabel.textContent = 'Pupil: ' + pct + '%';
        pupilBarFill.style.width = pct + '%';
    });
})();
