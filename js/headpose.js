/**
 * HeadPoseTracker — Tracks head position and rotation using FaceMesh landmarks
 * from WebGazer's tracker, computes gaze offset to compensate for head movement.
 *
 * Compensates for X/Y translation and yaw/pitch rotation.
 * Z depth changes are handled by scaling the offset and optionally disabling
 * correction when Z deviates too far from calibration range.
 */
const HeadPoseTracker = (function () {
    const NOSE_TIP = 1;
    const LEFT_EYE_OUTER = 33;
    const RIGHT_EYE_OUTER = 263;

    const LANDMARK_INDICES = [NOSE_TIP, LEFT_EYE_OUTER, RIGHT_EYE_OUTER];

    // Sensitivity: px of gaze offset per px of landmark shift
    var SENSITIVITY_X = 2.0;
    var SENSITIVITY_Y = 1.5;
    var SENSITIVITY_YAW = 3.0;
    var SENSITIVITY_PITCH = 2.0;

    // Dead zone: ignore landmark jitter smaller than this (in px)
    var DEAD_ZONE = 2.0;

    // Z depth: if scale deviates beyond this from calibrated range, fade out correction
    // This is expanded if depth calibration was performed
    var maxScaleDeviation = 0.15;
    var depthCalibrated = false;

    // EMA smoothing for the offset
    var SMOOTH_ALPHA = 0.2;

    // State
    var referencePose = null;
    var smoothOffsetX = 0;
    var smoothOffsetY = 0;
    var active = false;
    var flipX = -1; // default flipped (mirrored webcam)
    var flipY = 1;

    function captureReference() {
        var landmarks = getCurrentLandmarks();
        if (!landmarks) return false;

        referencePose = {
            interEyeDist: distance(
                landmarks[LEFT_EYE_OUTER],
                landmarks[RIGHT_EYE_OUTER]
            ),
            noseTip: landmarks[NOSE_TIP].slice(),
            eyeCenter: midpoint(
                landmarks[LEFT_EYE_OUTER],
                landmarks[RIGHT_EYE_OUTER]
            )
        };

        smoothOffsetX = 0;
        smoothOffsetY = 0;
        active = true;
        return true;
    }

    /**
     * Call after depth calibration to widen the accepted Z range.
     */
    function markDepthCalibrated() {
        depthCalibrated = true;
        maxScaleDeviation = 0.35; // allow 35% deviation
    }

    function getOffset() {
        if (!active || !referencePose) return { x: 0, y: 0 };

        var landmarks = getCurrentLandmarks();
        if (!landmarks) return { x: smoothOffsetX, y: smoothOffsetY };

        var currentNose = landmarks[NOSE_TIP];
        var currentEyeCenter = midpoint(
            landmarks[LEFT_EYE_OUTER],
            landmarks[RIGHT_EYE_OUTER]
        );
        var currentInterEyeDist = distance(
            landmarks[LEFT_EYE_OUTER],
            landmarks[RIGHT_EYE_OUTER]
        );

        // Z depth ratio: >1 = closer, <1 = farther
        var scaleRatio = referencePose.interEyeDist > 0
            ? currentInterEyeDist / referencePose.interEyeDist
            : 1;

        var scaleDev = Math.abs(scaleRatio - 1);

        // If beyond max range, fade correction to zero
        if (scaleDev > maxScaleDeviation) {
            smoothOffsetX *= 0.9;
            smoothOffsetY *= 0.9;
            return { x: smoothOffsetX, y: smoothOffsetY };
        }

        // Fade factor: full strength in dead zone center, fading at edges
        var fadeFactor = 1;
        if (scaleDev > maxScaleDeviation * 0.7) {
            fadeFactor = 1 - (scaleDev - maxScaleDeviation * 0.7) / (maxScaleDeviation * 0.3);
        }

        // --- Translation (X/Y shift, normalized by scale for Z compensation) ---
        var transX = (currentNose[0] - referencePose.noseTip[0]) / scaleRatio;
        var transY = (currentNose[1] - referencePose.noseTip[1]) / scaleRatio;

        // --- Yaw (nose lateral shift relative to eye center) ---
        var refNoseToEyeX = referencePose.noseTip[0] - referencePose.eyeCenter[0];
        var curNoseToEyeX = currentNose[0] - currentEyeCenter[0];
        var yawShift = (curNoseToEyeX - refNoseToEyeX) / scaleRatio;

        // --- Pitch (nose vertical shift relative to eye center) ---
        var refNoseToEyeY = referencePose.noseTip[1] - referencePose.eyeCenter[1];
        var curNoseToEyeY = currentNose[1] - currentEyeCenter[1];
        var pitchShift = (curNoseToEyeY - refNoseToEyeY) / scaleRatio;

        // Dead zone
        transX = applyDeadZone(transX, DEAD_ZONE);
        transY = applyDeadZone(transY, DEAD_ZONE);
        yawShift = applyDeadZone(yawShift, DEAD_ZONE * 0.5);
        pitchShift = applyDeadZone(pitchShift, DEAD_ZONE * 0.5);

        // Combine into offset with fade factor
        var rawOffsetX = fadeFactor * flipX * (transX * SENSITIVITY_X + yawShift * SENSITIVITY_YAW);
        var rawOffsetY = fadeFactor * flipY * (transY * SENSITIVITY_Y + pitchShift * SENSITIVITY_PITCH);

        // EMA smooth
        smoothOffsetX = smoothOffsetX + SMOOTH_ALPHA * (rawOffsetX - smoothOffsetX);
        smoothOffsetY = smoothOffsetY + SMOOTH_ALPHA * (rawOffsetY - smoothOffsetY);

        return { x: smoothOffsetX, y: smoothOffsetY };
    }

    function reset() {
        referencePose = null;
        smoothOffsetX = 0;
        smoothOffsetY = 0;
        active = false;
        depthCalibrated = false;
        maxScaleDeviation = 0.15;
    }

    function isActive() {
        return active;
    }

    // ── Helpers ──

    function getCurrentLandmarks() {
        try {
            var tracker = webgazer.getTracker();
            var positions = tracker.getPositions();
            if (!positions || positions.length < 468) return null;
            var lm = {};
            for (var i = 0; i < LANDMARK_INDICES.length; i++) {
                var idx = LANDMARK_INDICES[i];
                lm[idx] = [positions[idx][0], positions[idx][1]];
            }
            return lm;
        } catch (e) {
            return null;
        }
    }

    function distance(a, b) {
        var dx = a[0] - b[0];
        var dy = a[1] - b[1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    function midpoint(a, b) {
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }

    function applyDeadZone(value, threshold) {
        if (Math.abs(value) < threshold) return 0;
        return value > 0 ? value - threshold : value + threshold;
    }

    function toggleFlipX() {
        flipX *= -1;
        smoothOffsetX = 0;
        return flipX;
    }

    function toggleFlipY() {
        flipY *= -1;
        smoothOffsetY = 0;
        return flipY;
    }

    return { captureReference, getOffset, reset, isActive, toggleFlipX, toggleFlipY, markDepthCalibrated };
})();
