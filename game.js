// ============================================
// CLIMBING GAME - Main Game Logic
// ============================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    // Physics
    gravity: 0.3,
    maxFallSpeed: 15,

    // Stick figure dimensions
    headRadius: 15,
    torsoLength: 50,
    upperArmLength: 35,
    lowerArmLength: 30,
    upperLegLength: 45,
    lowerLegLength: 40,

    // Limb movement
    limbReachSpeed: 8,
    maxLimbReach: 120,

    // Wall Generation
    noiseScale: 0.02,         // Finer scale for rock detail
    noiseOctaves: 4,          // More layers of detail

    // Golden Path
    pathScale: 0.003,         // How fast the path winds (low freq)
    pathWidth: 200,           // Width of the "good" zone

    // Grabbing & Difficulty
    grabThreshold: 0.15,      // Very lenient (can grab almost anything)

    // Grip Physics
    minGripToHold: 0.4,       // Minimum total grip needed to not slip
    playerWeight: 1.0,        // Total required grip is 1.0 (if hands + feet)

    // Ground
    groundY: 0, // Will be set based on canvas height

    // Colors
    wallColor: '#2d3436',
    wallPatternColor: '#636e72',
    stickFigureColor: '#ffffff',
    selectedLimbColor: '#667eea',
    attachedLimbColor: '#4caf50',
    groundColor: '#5d4e37',
    groundTopColor: '#8b7355'
};

// ============================================
// SIMPLEX NOISE IMPLEMENTATION
// ============================================
const SimplexNoise = (function () {
    // Permutation table
    const perm = new Uint8Array(512);
    const gradP = new Array(512);

    const grad3 = [
        [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
        [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
        [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
    ];

    // Seed the noise
    function seed(s) {
        if (s > 0 && s < 1) s *= 65536;
        s = Math.floor(s);
        if (s < 256) s |= s << 8;

        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            p[i] = i;
        }
        for (let i = 255; i > 0; i--) {
            s = (s * 16807) % 2147483647;
            const j = s % (i + 1);
            [p[i], p[j]] = [p[j], p[i]];
        }
        for (let i = 0; i < 512; i++) {
            perm[i] = p[i & 255];
            gradP[i] = grad3[perm[i] % 12];
        }
    }

    // 2D Simplex noise
    function noise2D(x, y) {
        const F2 = 0.5 * (Math.sqrt(3) - 1);
        const G2 = (3 - Math.sqrt(3)) / 6;

        const s = (x + y) * F2;
        const i = Math.floor(x + s);
        const j = Math.floor(y + s);
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = x - X0;
        const y0 = y - Y0;

        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; }
        else { i1 = 0; j1 = 1; }

        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2;
        const y2 = y0 - 1 + 2 * G2;

        const ii = i & 255;
        const jj = j & 255;

        let n0 = 0, n1 = 0, n2 = 0;

        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) {
            const gi0 = gradP[ii + perm[jj]];
            t0 *= t0;
            n0 = t0 * t0 * (gi0[0] * x0 + gi0[1] * y0);
        }

        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) {
            const gi1 = gradP[ii + i1 + perm[jj + j1]];
            t1 *= t1;
            n1 = t1 * t1 * (gi1[0] * x1 + gi1[1] * y1);
        }

        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) {
            const gi2 = gradP[ii + 1 + perm[jj + 1]];
            t2 *= t2;
            n2 = t2 * t2 * (gi2[0] * x2 + gi2[1] * y2);
        }

        return 70 * (n0 + n1 + n2);
    }

    seed(Math.random() * 10000);

    return { noise2D, seed };
})();

// Get grabbability at world position (0-1, higher = better grip)
// Get grabbability at world position (0-1, higher = better grip)
function getGrabbabilityAt(x, y) {
    // 1. Calculate Golden Path Influence
    // A wandering path up the wall where rock quality is better
    // Use low-frequency noise for the path center
    const pathNoise = SimplexNoise.noise2D(0, y * CONFIG.pathScale);
    const pathCenter = canvas.width / 2 + pathNoise * (canvas.width * 0.4);

    const distFromPath = Math.abs(x - pathCenter);
    // 1.0 on path, dropping to 0.0 away from path
    const pathFactor = Math.max(0, 1 - distFromPath / CONFIG.pathWidth);

    // 2. Generate Ridged Multifractal Noise (Rock-like cracks)
    let value = 0;
    let amplitude = 1;
    let frequency = CONFIG.noiseScale;
    let maxValue = 0;

    for (let i = 0; i < CONFIG.noiseOctaves; i++) {
        // Ridged noise: 1 - abs(noise) creates sharp valleys
        let n = SimplexNoise.noise2D(x * frequency, y * frequency);
        n = 1 - Math.abs(n);
        n = n * n * n; // Sharpen the ridges

        value += amplitude * n;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    let noiseVal = value / maxValue; // 0-1 range

    // 3. Combine: Path improves the *quality* and *density* of holds
    // Off-path: noise is suppressed (smoother, harder to grip)
    // On-path: noise is preserved or enhanced

    // Base detail level (always some crack available, but maybe faint)
    // INCREASED from 0.2 to 0.4 to make off-path climbing possible (but harder)
    const baseDetail = 0.4;

    // Final grabbability
    const finalVal = noiseVal * (baseDetail + 0.6 * pathFactor);

    return finalVal;
}

// ============================================
// GAME STATE
// ============================================
let gameState = {
    camera: { y: 0 },
    selectedLimb: 'rightArm',
    mousePos: { x: 0, y: 0 },
    maxHeight: 0,
    gameOver: false,
    falling: false,
    onGround: true,
    keysPressed: {} // Track held keys for smooth movement
};

// Stick figure state
let player = {
    // Torso position (center of the body)
    x: 0,
    y: 0,
    velocityY: 0,

    // Limb endpoints (hands and feet positions)
    // Each limb tracks: position, grab info (x, y, stickiness), previous grab for return
    limbs: {
        leftArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
        rightArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
        leftLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false },
        rightLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false }
    }
};

// ============================================
// INITIALIZATION
// ============================================
function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Input events
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    // Initialize player position (standing on ground)
    // Body center should be positioned so feet can reach ground
    const standingHeight = CONFIG.torsoLength / 2 + CONFIG.upperLegLength + CONFIG.lowerLegLength - 20;
    player.x = canvas.width / 2;
    player.y = CONFIG.groundY - standingHeight;

    // Initialize limb positions
    initializeLimbs();

    // Start game loop
    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    CONFIG.groundY = canvas.height - 50; // Ground is 50px from bottom
}

function initializeLimbs() {
    const shoulderY = player.y - CONFIG.torsoLength / 2;
    const hipY = player.y + CONFIG.torsoLength / 2;

    player.limbs.leftArm.x = player.x - 40;
    player.limbs.leftArm.y = shoulderY + 20;

    player.limbs.rightArm.x = player.x + 40;
    player.limbs.rightArm.y = shoulderY + 20;

    // Place feet on ground
    player.limbs.leftLeg.x = player.x - 25;
    player.limbs.leftLeg.y = CONFIG.groundY;
    player.limbs.leftLeg.onGround = true;

    player.limbs.rightLeg.x = player.x + 25;
    player.limbs.rightLeg.y = CONFIG.groundY;
    player.limbs.rightLeg.onGround = true;
}

// Noise-based wall doesn't need starting holds - player starts on ground

// ============================================
// INPUT HANDLING
// ============================================
function handleKeyDown(e) {
    if (gameState.gameOver) {
        if (e.code === 'Space') {
            restartGame();
        }
        return;
    }

    if (gameState.keysPressed[e.key]) return; // Prevent repeat

    const keyMap = {
        'q': 'leftArm',
        'Q': 'leftArm',
        'e': 'rightArm',
        'E': 'rightArm',
        'a': 'leftLeg',
        'A': 'leftLeg',
        'd': 'rightLeg',
        'D': 'rightLeg'
    };

    if (keyMap[e.key]) {
        const newLimb = keyMap[e.key];
        const previousLimb = gameState.selectedLimb;

        // If switching to a different limb
        if (newLimb !== previousLimb) {
            const prevLimbObj = player.limbs[previousLimb];
            // Just clear release state, do NOT return to hold/ground
            prevLimbObj.wasReleased = false;
            prevLimbObj.previousGrab = null;
        }

        const limb = player.limbs[newLimb];

        // If selecting the same limb that's already selected
        if (newLimb === previousLimb) {
            // Double-press = permanent release (never returns to previous hold)
            limb.previousGrab = null;
            limb.wasReleased = false;

            // Release grab/ground
            if (limb.grabbedAt || limb.onGround) {
                limb.grabbedAt = null;
                limb.onGround = false;
            }
        } else {
            // Selecting a new limb - auto-release if attached
            if (limb.grabbedAt) {
                limb.grabbedAt = null;
                limb.wasReleased = true;
            } else if (limb.onGround) {
                limb.onGround = false;
                limb.wasReleased = true;
            }
            // Clear previousGrab to ensure no snapping reference remains
            limb.previousGrab = null;
        }

        gameState.selectedLimb = newLimb;
        updateHUD();
    }

    // Track key state for smooth movement
    gameState.keysPressed[e.key] = true;
}

function handleKeyUp(e) {
    gameState.keysPressed[e.key] = false;
}

function handleMouseMove(e) {
    gameState.mousePos.x = e.clientX;
    gameState.mousePos.y = e.clientY + gameState.camera.y;
}

function handleClick(e) {
    if (gameState.gameOver) return;

    const limb = player.limbs[gameState.selectedLimb];

    // If already grabbed or on ground, release it
    if (limb.grabbedAt || limb.onGround) {
        limb.grabbedAt = null;
        limb.onGround = false;
        limb.wasReleased = true;
        limb.previousGrab = null;
        updateHUD();
        return;
    }

    // Try to grab at current limb position
    const stickiness = getGrabbabilityAt(limb.x, limb.y);
    const canGrab = stickiness >= CONFIG.grabThreshold;

    if (canGrab) {
        // Check leg constraint - legs cannot grab holds too far above torso
        if (gameState.selectedLimb.includes('Leg')) {
            const shoulderY = player.y - CONFIG.torsoLength / 2;
            if (limb.y < shoulderY) {
                // Limb is above shoulders, don't allow leg to grab
                return;
            }
        }

        // We rely on limb physics to keep it within reach, so we valid grab at current position
        limb.grabbedAt = {
            x: limb.x,
            y: limb.y,
            stickiness: stickiness
        };

        // Clear release state since we grabbed
        limb.wasReleased = false;
        limb.previousGrab = null;

        updateHUD();
    }
}

// ============================================
// PHYSICS & GAME LOGIC
// ============================================
function update() {
    if (gameState.gameOver) return;

    // Move selected limb towards cursor (if not attached)
    updateSelectedLimb();

    // Handle smooth horizontal movement on ground
    updateGroundMovement();

    // Update free limbs to follow body naturally
    updateFreeLimbs();

    // Calculate total grip
    const totalGrip = calculateTotalGrip();

    // Check if any feet are on ground
    const feetOnGround = (player.limbs.leftLeg.onGround || player.limbs.rightLeg.onGround);

    // Apply physics
    if (totalGrip < CONFIG.playerWeight && !feetOnGround) {
        // Not enough grip and not on ground - potential slipping/falling

        // 1. SLIPPING LOGIC (Weak holds detach)
        // Find attached limbs
        let attachedLimbs = [];
        for (const limbName in player.limbs) {
            const limb = player.limbs[limbName];
            if (limb.grabbedAt) {
                attachedLimbs.push({ name: limbName, stickiness: limb.grabbedAt.stickiness });
            }
        }

        if (attachedLimbs.length > 0) {
            // Sort by stickiness (weakest first)
            attachedLimbs.sort((a, b) => a.stickiness - b.stickiness);

            // The weakest limb slips
            const weakest = attachedLimbs[0];
            const deficit = CONFIG.playerWeight - totalGrip;
            // Chance to slip increases with grip deficit
            const slipChance = 0.05 + (deficit * 0.1);

            if (Math.random() < slipChance) {
                player.limbs[weakest.name].grabbedAt = null;
                player.limbs[weakest.name].wasReleased = true;
            }
        }

        // 2. FALLING LOGIC (Gravity)
        // If we have minimal grip (or just generally insufficient), logic dictates we fall
        // But the tether constraint prevents falling if at least one strong hold exists.
        // However, if we are here, total grip is < 1.0.

        // Apply gravity
        gameState.falling = true;
        gameState.onGround = false;
        player.velocityY += CONFIG.gravity;
        player.velocityY = Math.min(player.velocityY, CONFIG.maxFallSpeed);
        player.y += player.velocityY;

        // Drag free limbs with body
        for (const limbName in player.limbs) {
            const limb = player.limbs[limbName];
            if (!limb.grabbedAt) {
                limb.y += player.velocityY;
            }
        }

        // 3. GROUND COLLISION
        const feetY = player.y + CONFIG.torsoLength / 2 + CONFIG.upperLegLength + CONFIG.lowerLegLength;
        if (feetY >= CONFIG.groundY) {
            // Land on ground
            player.y = CONFIG.groundY - CONFIG.torsoLength / 2 - CONFIG.upperLegLength - CONFIG.lowerLegLength + 50;
            player.velocityY = 0;
            gameState.falling = false;
            gameState.onGround = true;

            // Place feet on ground ONLY if they are not selected
            if (gameState.selectedLimb !== 'leftLeg') {
                player.limbs.leftLeg.y = CONFIG.groundY;
                player.limbs.leftLeg.onGround = true;
            }
            if (gameState.selectedLimb !== 'rightLeg') {
                player.limbs.rightLeg.y = CONFIG.groundY;
                player.limbs.rightLeg.onGround = true;
            }
        }

    } else {
        // SUFFICIENT GRIP OR ON GROUND - STABLE
        gameState.falling = false;
        player.velocityY = 0;

        if (feetOnGround) {
            gameState.onGround = true;
            // Keep feet planted on ground
            if (player.limbs.leftLeg.onGround) player.limbs.leftLeg.y = CONFIG.groundY;
            if (player.limbs.rightLeg.onGround) player.limbs.rightLeg.y = CONFIG.groundY;
        }

        updateBodyPosition();
    }

    // Update camera
    updateCamera();

    // Update max height
    const currentHeight = Math.max(0, Math.floor(-player.y / 50));
    gameState.maxHeight = Math.max(gameState.maxHeight, currentHeight);

    // Check for game over (fell too far below)
    if (player.y > canvas.height + 500) {
        triggerGameOver();
    }

    // Update grip meter in HUD
    updateGripMeter(totalGrip);
}

function updateSelectedLimb() {
    const limb = player.limbs[gameState.selectedLimb];

    // Only move if not attached and not on ground
    if (!limb.grabbedAt && !limb.onGround) {
        const dx = gameState.mousePos.x - limb.x;
        const dy = gameState.mousePos.y - limb.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 5) {
            const speed = Math.min(CONFIG.limbReachSpeed, dist);
            limb.x += (dx / dist) * speed;
            limb.y += (dy / dist) * speed;
        }

        // Constrain limb to max reach from body anchor point
        constrainLimbToBody(limb, gameState.selectedLimb);
    }
}

// Handle smooth horizontal movement on ground
function updateGroundMovement() {
    if (!gameState.onGround) return;

    const moveSpeed = 3;
    let dx = 0;

    if (gameState.keysPressed['ArrowLeft'] || gameState.keysPressed['Left']) {
        dx = -moveSpeed;
    } else if (gameState.keysPressed['ArrowRight'] || gameState.keysPressed['Right']) {
        dx = moveSpeed;
    }

    if (dx !== 0) {
        player.x += dx;
        // Move grounded feet with body
        if (player.limbs.leftLeg.onGround) {
            player.limbs.leftLeg.x += dx;
        }
        if (player.limbs.rightLeg.onGround) {
            player.limbs.rightLeg.x += dx;
        }
        // Also move attached arms slightly to keep them looking natural
        for (const limbName of ['leftArm', 'rightArm']) {
            const limb = player.limbs[limbName];
            if (!limb.grabbedAt) {
                limb.x += dx;
            }
        }
    }
}

// Update free (non-attached, non-selected) limbs to follow body naturally
function updateFreeLimbs() {
    for (const limbName in player.limbs) {
        const limb = player.limbs[limbName];

        // Skip if this is the selected limb, or if attached/on ground
        if (limbName === gameState.selectedLimb) continue;
        if (limb.grabbedAt || limb.onGround) continue;

        // Calculate natural resting position for this limb
        const isArm = limbName.includes('Arm');
        const isLeft = limbName.includes('left');

        const anchorY = isArm ?
            player.y - CONFIG.torsoLength / 2 :
            player.y + CONFIG.torsoLength / 2;
        const anchorX = player.x + (isLeft ? -10 : 10);

        // Natural resting position - slightly extended outward and down
        const restOffsetX = isLeft ? -30 : 30;
        const restOffsetY = isArm ? 20 : 50;

        const naturalX = anchorX + restOffsetX;
        const naturalY = anchorY + restOffsetY;

        // Smoothly move limb toward natural position
        limb.x += (naturalX - limb.x) * 0.1;
        limb.y += (naturalY - limb.y) * 0.1;

        // Constrain to max reach
        constrainLimbToBody(limb, limbName);
    }
}

function constrainLimbToBody(limb, limbName) {
    const isArm = limbName.includes('Arm');
    const anchorY = isArm ?
        player.y - CONFIG.torsoLength / 2 :
        player.y + CONFIG.torsoLength / 2;
    const anchorX = player.x + (limbName.includes('left') ? -10 : 10);

    const maxReach = isArm ?
        CONFIG.upperArmLength + CONFIG.lowerArmLength :
        CONFIG.upperLegLength + CONFIG.lowerLegLength;

    const dx = limb.x - anchorX;
    const dy = limb.y - anchorY;
    const dist = Math.hypot(dx, dy);

    if (dist > maxReach) {
        limb.x = anchorX + (dx / dist) * maxReach;
        limb.y = anchorY + (dy / dist) * maxReach;
    }
}

function calculateTotalGrip() {
    let total = 0;
    for (const limbName in player.limbs) {
        const limb = player.limbs[limbName];
        if (limb.grabbedAt) {
            total += limb.grabbedAt.stickiness;
        }
        // Feet on ground count as full grip
        if (limb.onGround) {
            total += 1.0;
        }
    }
    return total;
}


function updateBodyPosition() {
    const leftArmAttached = player.limbs.leftArm.grabbedAt;
    const rightArmAttached = player.limbs.rightArm.grabbedAt;
    const leftLegAttached = player.limbs.leftLeg.grabbedAt || player.limbs.leftLeg.onGround;
    const rightLegAttached = player.limbs.rightLeg.grabbedAt || player.limbs.rightLeg.onGround;

    const legsSupported = leftLegAttached || rightLegAttached;
    const armsAttached = leftArmAttached || rightArmAttached;

    // Calculate leg support position (average of attached leg positions)
    let legSupportY = 0;
    let legSupportX = 0;
    let legCount = 0;

    if (leftLegAttached) {
        legSupportY += player.limbs.leftLeg.y;
        legSupportX += player.limbs.leftLeg.x;
        legCount++;
    }
    if (rightLegAttached) {
        legSupportY += player.limbs.rightLeg.y;
        legSupportX += player.limbs.rightLeg.x;
        legCount++;
    }

    if (legCount > 0) {
        legSupportY /= legCount;
        legSupportX /= legCount;
    }

    // SPRINGY STAND-UP PHYSICS
    // When legs are supported, body tries to "stand up" above the legs
    if (legsSupported) {
        // Calculate ideal standing position - body should be above legs
        const legLength = CONFIG.upperLegLength + CONFIG.lowerLegLength;
        const idealBodyY = legSupportY - legLength - CONFIG.torsoLength / 2 + 20;

        // Spring force pushes body upward towards standing position
        const springStrength = 0.15;
        const targetY = idealBodyY;

        // If arms are also attached, blend between arm pull and leg push
        if (armsAttached) {
            let armY = 0;
            let armX = 0;
            let armCount = 0;

            if (leftArmAttached) {
                armY += player.limbs.leftArm.y;
                armX += player.limbs.leftArm.x;
                armCount++;
            }
            if (rightArmAttached) {
                armY += player.limbs.rightArm.y;
                armX += player.limbs.rightArm.x;
                armCount++;
            }

            if (armCount > 0) {
                armY /= armCount;
                armX /= armCount;
            }

            // Body position is between arms (above) and ideal standing position
            // Legs push up, arms anchor the upper body
            const armPullStrength = 0.3;
            const armTargetY = armY + CONFIG.upperArmLength; // Body below arms

            // Blend: prefer the higher (more negative Y) position when standing up
            const blendedY = Math.min(targetY, armTargetY);
            player.y += (blendedY - player.y) * springStrength;

            // X position is average of all attachment points
            const targetX = (legSupportX + armX) / 2;
            player.x += (targetX - player.x) * 0.1;
        } else {
            // Only legs attached - stand up fully
            player.y += (targetY - player.y) * springStrength;
            player.x += (legSupportX - player.x) * 0.1;
        }
    } else if (armsAttached) {
        // Only arms attached - body hangs below
        let armY = 0;
        let armX = 0;
        let armCount = 0;

        if (leftArmAttached) {
            armY += player.limbs.leftArm.y;
            armX += player.limbs.leftArm.x;
            armCount++;
        }
        if (rightArmAttached) {
            armY += player.limbs.rightArm.y;
            armX += player.limbs.rightArm.x;
            armCount++;
        }

        if (armCount > 0) {
            armY /= armCount;
            armX /= armCount;
        }

        // Body hangs below arms
        const hangDistance = CONFIG.upperArmLength + CONFIG.lowerArmLength - 20;
        const targetY = armY + hangDistance;

        player.y += (targetY - player.y) * 0.1;
        player.x += (armX - player.x) * 0.1;
    }

    // BODY LEANING AND EXTENSION PHYSICS
    // When reaching with a limb, body leans toward that direction and extends vertically
    const selectedLimb = player.limbs[gameState.selectedLimb];
    if (!selectedLimb.grabbedAt && !selectedLimb.onGround) {
        // Calculate how far the limb is from the body center
        const limbOffsetX = selectedLimb.x - player.x;
        const limbOffsetY = selectedLimb.y - player.y;

        // Only apply if we have support (legs attached or on ground)
        if (legsSupported) {
            // HORIZONTAL LEAN
            const maxLean = 30; // Maximum lean in pixels
            const leanFactor = 0.15; // How much body responds to limb position
            let leanAmount = limbOffsetX * leanFactor;
            leanAmount = Math.max(-maxLean, Math.min(maxLean, leanAmount));

            const leanTarget = legSupportX + leanAmount;
            player.x += (leanTarget - player.x) * 0.08;

            // VERTICAL EXTENSION when reaching UP
            // If limb is reaching above the body, stand up more
            if (limbOffsetY < -20) { // Limb is above body
                const legLength = CONFIG.upperLegLength + CONFIG.lowerLegLength;
                // Calculate maximum standing height (fully extended legs)
                const maxStandY = legSupportY - legLength - CONFIG.torsoLength / 2 + 10;

                // How much to extend based on how high the limb is reaching
                const extensionFactor = Math.min(1, Math.abs(limbOffsetY) / 100);
                const currentY = player.y;
                const targetY = currentY + (maxStandY - currentY) * extensionFactor;

                // Stand up toward the reaching limb
                player.y += (targetY - player.y) * 0.12;
            }
        }
    }

    // Constrain all attached limbs to stay connected to their grab points
    for (const limbName in player.limbs) {
        const limb = player.limbs[limbName];
        if (limb.grabbedAt) {
            limb.x = limb.grabbedAt.x;
            limb.y = limb.grabbedAt.y;
        }
    }

    // FINAL CONSTRAINT: Ensure body doesn't move beyond reach of ANY attached limb
    // This prevents legs from stretching infinitely when arms pull body up
    const ITERATIONS = 3; // minimal iterations for stability
    for (let i = 0; i < ITERATIONS; i++) {
        for (const limbName in player.limbs) {
            const limb = player.limbs[limbName];
            if (limb.grabbedAt || limb.onGround) {
                const isArm = limbName.includes('Arm');
                const isLeft = limbName.includes('left');
                const anchorOffsetY = isArm ? -CONFIG.torsoLength / 2 : CONFIG.torsoLength / 2;
                const anchorOffsetX = isLeft ? -10 : 10;

                // Current anchor world position
                const anchorX = player.x + anchorOffsetX;
                const anchorY = player.y + anchorOffsetY;

                const dx = limb.x - anchorX;
                const dy = limb.y - anchorY;
                const dist = Math.hypot(dx, dy);

                const maxLen = isArm ?
                    (CONFIG.upperArmLength + CONFIG.lowerArmLength) :
                    (CONFIG.upperLegLength + CONFIG.lowerLegLength);

                if (dist > maxLen) {
                    // Body is too far! Pull body towards limb
                    const pullDist = dist - maxLen;
                    const pullX = (dx / dist) * pullDist;
                    const pullY = (dy / dist) * pullDist;

                    player.x += pullX;
                    player.y += pullY;
                }
            }
        }
    }
}

function updateCamera() {
    // Camera follows player smoothly
    const targetCameraY = player.y - canvas.height / 2;
    gameState.camera.y += (targetCameraY - gameState.camera.y) * 0.05;
}

function triggerGameOver() {
    gameState.gameOver = true;
    showGameOverScreen();
}

function showGameOverScreen() {
    const overlay = document.createElement('div');
    overlay.className = 'game-over';
    overlay.innerHTML = `
        <h1>FELL!</h1>
        <p>Max Height: ${gameState.maxHeight}m</p>
        <button onclick="restartGame()">Try Again</button>
    `;
    document.body.appendChild(overlay);

    setTimeout(() => overlay.classList.add('visible'), 10);
}

function restartGame() {
    // Remove game over screen
    const overlay = document.querySelector('.game-over');
    if (overlay) overlay.remove();

    // Reset game state
    gameState = {
        camera: { y: 0 },
        selectedLimb: 'rightArm',
        mousePos: { x: 0, y: 0 },
        maxHeight: 0,
        gameOver: false,
        falling: false,
        onGround: true,
        keysPressed: {}
    };

    player = {
        x: canvas.width / 2,
        y: canvas.height - 200,
        velocityY: 0,
        limbs: {
            leftArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
            rightArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
            leftLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false },
            rightLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false }
        }
    };

    initializeLimbs();
    updateHUD();
}

// ============================================
// RENDERING
// ============================================
function render() {
    // Clear canvas
    ctx.fillStyle = CONFIG.wallColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Save context and apply camera transform
    ctx.save();
    ctx.translate(0, -gameState.camera.y);

    // Draw wall pattern (now inside transform)
    drawWallTexture();

    // Draw ground
    drawGround();

    // Draw stick figure
    drawStickFigureBody();
    drawLimbs();

    ctx.restore();
}

function drawGround() {
    // Only draw ground if it's visible
    if (CONFIG.groundY < gameState.camera.y || CONFIG.groundY > gameState.camera.y + canvas.height + 100) {
        return;
    }

    // Draw ground body
    ctx.fillStyle = CONFIG.groundColor;
    ctx.fillRect(0, CONFIG.groundY, canvas.width, 200);

    // Draw ground top edge
    ctx.fillStyle = CONFIG.groundTopColor;
    ctx.fillRect(0, CONFIG.groundY, canvas.width, 10);

    // Draw some texture on ground
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    for (let x = 0; x < canvas.width; x += 40) {
        ctx.fillRect(x, CONFIG.groundY + 15, 20, 5);
        ctx.fillRect(x + 20, CONFIG.groundY + 35, 15, 5);
    }
}

function drawWallTexture() {
    // Only draw visible portion of wall
    const startY = Math.floor(gameState.camera.y);
    const endY = Math.floor(gameState.camera.y + canvas.height);

    // Optimization: render in chunks or use a predefined pattern
    const resolution = 8; // Slightly finer res

    const startGridY = Math.floor(startY / resolution) * resolution - resolution;
    const endGridY = Math.ceil(endY / resolution) * resolution + resolution;

    for (let y = startGridY; y < endGridY; y += resolution) {
        for (let x = 0; x < canvas.width; x += resolution) {
            // Sample noise at center of block
            const noiseVal = getGrabbabilityAt(x + resolution / 2, y + resolution / 2);

            // Ridged noise visualization
            // noiseVal matches the getGrabbabilityAt output (roughly 0 to 1)

            let r, g, b;

            if (noiseVal < CONFIG.grabThreshold) {
                // Unclimbable (Smooth/Dark)
                // Map 0 -> Threshold to Dark Gray -> Dark Blue/Slate
                const val = (noiseVal / CONFIG.grabThreshold);
                const colorVal = 30 + Math.floor(val * 20);
                r = colorVal;
                g = colorVal + 5;
                b = colorVal + 10;
            } else {
                // Climbable (Ridges/Cracks)
                // Higher value = deeper/better crack
                // Visualize as lighter/highlighted rock

                // Normalized quality of hold (0 to 1)
                const quality = (noiseVal - CONFIG.grabThreshold) / (1 - CONFIG.grabThreshold);

                // Color ramp: Dark Slate -> Grey -> slightly greenish/brownish highlight
                // We want it to look like rock, not neon

                const base = 60;
                const highlight = Math.floor(quality * 100);

                // Add subtle green tint for "Golden Path" area (implied by higher values)
                // but keep it camouflaged
                r = base + highlight;
                g = base + highlight + 10; // Slight green hint
                b = base + highlight;
            }

            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(x, y, resolution, resolution);
        }
    }

    // Add vignette effect at edges
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(0.1, 'rgba(0,0,0,0)');
    grad.addColorStop(0.9, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, startY, canvas.width, canvas.height);
}



function drawStickFigureBody() {
    const headY = player.y - CONFIG.torsoLength / 2 - CONFIG.headRadius;
    const shoulderY = player.y - CONFIG.torsoLength / 2 + 5;
    const hipY = player.y + CONFIG.torsoLength / 2;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw torso
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - CONFIG.torsoLength / 2);
    ctx.lineTo(player.x, player.y + CONFIG.torsoLength / 2);
    ctx.strokeStyle = CONFIG.stickFigureColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Draw head
    ctx.beginPath();
    ctx.arc(player.x, headY, CONFIG.headRadius, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.stickFigureColor;
    ctx.fill();

    // Draw face
    ctx.fillStyle = CONFIG.wallColor;
    ctx.beginPath();
    ctx.arc(player.x - 5, headY - 2, 3, 0, Math.PI * 2);
    ctx.arc(player.x + 5, headY - 2, 3, 0, Math.PI * 2);
    ctx.fill();
}

function drawLimbs() {
    const limbs = ['leftLeg', 'rightLeg', 'leftArm', 'rightArm'];

    // Draw all limbs
    for (const limbName of limbs) {
        const limb = player.limbs[limbName];
        const isSelected = gameState.selectedLimb === limbName;
        const isAttached = limb.grabbedAt || limb.onGround;

        // Determine limb color
        let color = CONFIG.stickFigureColor;
        if (isSelected) color = CONFIG.selectedLimbColor;
        else if (isAttached) color = CONFIG.attachedLimbColor;
        // Make free limbs slightly transparent
        const alpha = isAttached || isSelected ? 1 : 0.7;

        drawLimb(limbName, limb, color, alpha);
    }

    // Draw grab indicators for attached limbs
    for (const limbName of limbs) {
        const limb = player.limbs[limbName];
        if (limb.grabbedAt) {
            ctx.beginPath();
            ctx.arc(limb.x, limb.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = CONFIG.attachedLimbColor;
            ctx.fill();

            // Draw ring indicating grip strength
            ctx.beginPath();
            ctx.arc(limb.x, limb.y, 8, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${limb.grabbedAt.stickiness})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Draw limb reach indicator for selected limb
    drawLimbReachIndicator();
}

function drawLimb(limbName, limb, color, alpha) {
    const endX = limb.x;
    const endY = limb.y;

    const isArm = limbName.includes('Arm');
    const isLeft = limbName.includes('left');

    const shoulderY = player.y - CONFIG.torsoLength / 2 + 5;
    const hipY = player.y + CONFIG.torsoLength / 2;
    const startX = player.x + (isLeft ? -10 : 10);
    const startY = isArm ? shoulderY : hipY;

    const upperLength = isArm ? CONFIG.upperArmLength : CONFIG.upperLegLength;
    const lowerLength = isArm ? CONFIG.lowerArmLength : CONFIG.lowerLegLength;

    // Calculate elbow/knee position using inverse kinematics
    const joint = calculateJoint(startX, startY, endX, endY, upperLength, lowerLength, isArm ? -1 : 1);

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = alpha;

    // Draw upper segment (shoulder/hip to elbow/knee)
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(joint.x, joint.y);
    ctx.stroke();

    // Draw lower segment (elbow/knee to hand/foot)
    ctx.beginPath();
    ctx.moveTo(joint.x, joint.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Draw joint circle
    ctx.beginPath();
    ctx.arc(joint.x, joint.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Draw hand/foot circle
    ctx.beginPath();
    ctx.arc(endX, endY, isArm ? 6 : 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

function calculateJoint(startX, startY, endX, endY, length1, length2, bendDirection) {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.hypot(dx, dy);

    // Clamp distance to valid range
    const maxDist = length1 + length2;
    const minDist = Math.abs(length1 - length2);

    let clampedDist = Math.max(minDist + 1, Math.min(maxDist - 1, dist));

    // Law of cosines to find angle at start
    const cosAngle1 = (length1 * length1 + clampedDist * clampedDist - length2 * length2) /
        (2 * length1 * clampedDist);
    const angle1 = Math.acos(Math.max(-1, Math.min(1, cosAngle1)));

    // Angle of line from start to end
    const baseAngle = Math.atan2(dy, dx);

    // Joint angle (with bend direction)
    const jointAngle = baseAngle + angle1 * bendDirection;

    return {
        x: startX + Math.cos(jointAngle) * length1,
        y: startY + Math.sin(jointAngle) * length1
    };
}

function drawLimbReachIndicator() {
    const limb = player.limbs[gameState.selectedLimb];

    if (!limb.grabbedAt) {
        // Draw circle around selected limb endpoint
        ctx.beginPath();
        ctx.arc(limb.x, limb.y, 15, 0, Math.PI * 2);
        ctx.strokeStyle = CONFIG.selectedLimbColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

// ============================================
// HUD UPDATES
// ============================================
function updateHUD() {
    // Update limb selection indicators
    document.querySelectorAll('.limb-control').forEach(el => {
        const limbName = el.dataset.limb;
        el.classList.toggle('active', limbName === gameState.selectedLimb);
        el.classList.toggle('attached', player.limbs[limbName]?.grabbedAt !== null);
    });

    // Update height display
    const height = Math.max(0, Math.floor(-player.y / 50));
    document.getElementById('heightDisplay').textContent = `Height: ${height}m`;
}

function updateGripMeter(grip) {
    const meterFill = document.getElementById('gripMeter');
    const percentage = Math.min(100, (grip / CONFIG.playerWeight) * 100);
    meterFill.style.width = `${percentage}%`;

    meterFill.classList.remove('warning', 'danger');
    if (percentage < 50) {
        meterFill.classList.add('danger');
    } else if (percentage < 100) {
        meterFill.classList.add('warning');
    }
}

// ============================================
// GAME LOOP
// ============================================
function gameLoop() {
    update();
    render();
    updateHUD();
    requestAnimationFrame(gameLoop);
}

// Make restartGame global for button onclick
window.restartGame = restartGame;

// Start the game
init();
