/**
 * HeadPoseTracker — Tracks head position and rotation using FaceMesh landmarks
 * from WebGazer's tracker, computes gaze offset to compensate for head movement.
 *
 * Uses key facial landmarks to estimate:
 *   - Translation (X/Y shift relative to reference)
 *   - Rotation (yaw, pitch, roll via landmark geometry)
 *
 * The reference pose is captured once after calibration. During live tracking,
 * the current pose is compared to the reference and a pixel offset is returned
 * for gaze correction.
 */
const HeadPoseTracker = (function () {
    // Key FaceMesh landmark indices for head pose estimation
    const NOSE_TIP = 1;
    const FOREHEAD = 10;
    const CHIN = 152;
    const LEFT_EYE_OUTER = 33;
    const RIGHT_EYE_OUTER = 263;
    const LEFT_EAR = 234;
    const RIGHT_EAR = 454;

    const LANDMARK_INDICES = [
        NOSE_TIP, FOREHEAD, CHIN,
        LEFT_EYE_OUTER, RIGHT_EYE_OUTER,
        LEFT_EAR, RIGHT_EAR
    ];

    // How aggressively head movement maps to gaze offset (px per px of head shift)
    // These are tuned for a typical webcam-to-screen setup
    var SENSITIVITY_X = 2.0;
    var SENSITIVITY_Y = 1.5;
    var SENSITIVITY_YAW = 3.0;   // px offset per px of yaw-induced landmark shift
    var SENSITIVITY_PITCH = 2.0; // px offset per px of pitch-induced landmark shift

    // Dead zone: ignore head shifts smaller than this (in landmark px)
    // Prevents micro-jitter from FaceMesh from creating constant small offsets
    var DEAD_ZONE = 2.0;

    // EMA smoothing for the offset to avoid jitter
    var SMOOTH_ALPHA = 0.2;

    // State
    var referencePose = null;
    var smoothOffsetX = 0;
    var smoothOffsetY = 0;
    var active = false;
    var flipX = 1;  // 1 or -1
    var flipY = 1;  // 1 or -1

    /**
     * Capture the current head pose as the reference (call after calibration).
     * Returns true if successful, false if landmarks unavailable.
     */
    function captureReference() {
        var landmarks = getCurrentLandmarks();
        if (!landmarks) return false;

        referencePose = {
            landmarks: landmarks,
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
     * Compute the gaze correction offset based on current head pose vs reference.
     * Returns { x, y } offset in screen pixels to ADD to the raw gaze prediction.
     * Returns { x: 0, y: 0 } if no reference or landmarks unavailable.
     */
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

        // Scale factor to normalize for distance-to-camera changes
        var scale = referencePose.interEyeDist > 0
            ? currentInterEyeDist / referencePose.interEyeDist
            : 1;

        // --- Translation offset ---
        // Nose tip shift (normalized by scale) indicates head translation
        var transX = (currentNose[0] - referencePose.noseTip[0]) / scale;
        var transY = (currentNose[1] - referencePose.noseTip[1]) / scale;

        // --- Yaw estimation ---
        // When the head rotates left/right, the nose shifts laterally relative
        // to the eye center. This ratio indicates yaw.
        var refNoseToEyeX = referencePose.noseTip[0] - referencePose.eyeCenter[0];
        var curNoseToEyeX = currentNose[0] - currentEyeCenter[0];
        var yawShift = (curNoseToEyeX - refNoseToEyeX) / scale;

        // --- Pitch estimation ---
        // When the head tilts up/down, the nose shifts vertically relative
        // to the eye center.
        var refNoseToEyeY = referencePose.noseTip[1] - referencePose.eyeCenter[1];
        var curNoseToEyeY = currentNose[1] - currentEyeCenter[1];
        var pitchShift = (curNoseToEyeY - refNoseToEyeY) / scale;

        // Apply dead zone — ignore small shifts that are just landmark noise
        transX = applyDeadZone(transX, DEAD_ZONE);
        transY = applyDeadZone(transY, DEAD_ZONE);
        yawShift = applyDeadZone(yawShift, DEAD_ZONE * 0.5);
        pitchShift = applyDeadZone(pitchShift, DEAD_ZONE * 0.5);

        // Combine translation and rotation into a single offset.
        // flipX allows the user to toggle the correction direction at runtime.
        var rawOffsetX = flipX * (transX * SENSITIVITY_X + yawShift * SENSITIVITY_YAW);
        var rawOffsetY = flipY * (transY * SENSITIVITY_Y + pitchShift * SENSITIVITY_PITCH);

        // EMA smooth the offset
        smoothOffsetX = smoothOffsetX + SMOOTH_ALPHA * (rawOffsetX - smoothOffsetX);
        smoothOffsetY = smoothOffsetY + SMOOTH_ALPHA * (rawOffsetY - smoothOffsetY);

        return { x: smoothOffsetX, y: smoothOffsetY };
    }

    /**
     * Stop tracking and clear reference.
     */
    function reset() {
        referencePose = null;
        smoothOffsetX = 0;
        smoothOffsetY = 0;
        active = false;
    }

    /**
     * Whether a reference pose has been captured and tracking is active.
     */
    function isActive() {
        return active;
    }

    // ── Helpers ──

    function getCurrentLandmarks() {
        try {
            var tracker = webgazer.getTracker();
            var positions = tracker.getPositions();
            if (!positions || positions.length < 468) return null;

            // Build a map of index → [x, y]
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
        // Subtract threshold so the response starts at 0 past the dead zone
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

    return { captureReference, getOffset, reset, isActive, toggleFlipX, toggleFlipY };
})();
