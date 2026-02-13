/**
 * App — Main orchestrator: WebGazer lifecycle, screen transitions, error handling.
 */
(function () {
    // ── Screen references ──
    const screens = {
        welcome: document.getElementById('screen-welcome'),
        calibration: document.getElementById('screen-calibration'),
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
            // Capture head pose reference right after calibration completes
            HeadPoseTracker.captureReference();
            startAccuracyTest();
        });
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
