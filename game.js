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
    minGripToHold: 0.3,       // Lower threshold to avoid instant falling
    playerWeight: 0.95,       // Slightly easier to hold weight
    fallGracePeriod: 60,      // Frames (~1 second) before falling when grip is lost

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
// UTILITIES (Noise & Math)
// ============================================

const SimplexNoise = (function () {
    const perm = new Uint8Array(512);
    const gradP = new Array(512);
    const grad3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];

    function seed(s) {
        if (s > 0 && s < 1) s *= 65536;
        s = Math.floor(s);
        if (s < 256) s |= s << 8;
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
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

    function noise2D(x, y) {
        const F2 = 0.5 * (Math.sqrt(3) - 1);
        const G2 = (3 - Math.sqrt(3)) / 6;
        const s = (x + y) * F2;
        const i = Math.floor(x + s);
        const j = Math.floor(y + s);
        const t = (i + j) * G2;
        const X0 = i - t, Y0 = j - t;
        const x0 = x - X0, y0 = y - Y0;
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
        const ii = i & 255, jj = j & 255;
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

function getGrabbabilityAt(x, y) {
    const pathNoise = SimplexNoise.noise2D(0, y * CONFIG.pathScale);
    const pathCenter = canvas.width / 2 + pathNoise * (canvas.width * 0.4);
    const distFromPath = Math.abs(x - pathCenter);
    const pathFactor = Math.max(0, 1 - distFromPath / CONFIG.pathWidth);

    let value = 0;
    let amplitude = 1;
    let frequency = CONFIG.noiseScale;
    let maxValue = 0;

    for (let i = 0; i < CONFIG.noiseOctaves; i++) {
        let n = SimplexNoise.noise2D(x * frequency, y * frequency);
        n = 1 - Math.abs(n);
        n = n * n * n;
        value += amplitude * n;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    const noiseVal = value / maxValue;
    const baseDetail = 0.4;
    return noiseVal * (baseDetail + 0.6 * pathFactor);
}

function calculateJoint(startX, startY, endX, endY, length1, length2, bendDirection) {
    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.hypot(dx, dy);
    const maxDist = length1 + length2;
    const minDist = Math.abs(length1 - length2);
    const clampedDist = Math.max(minDist + 1, Math.min(maxDist - 1, dist));

    const cosAngle1 = (length1 * length1 + clampedDist * clampedDist - length2 * length2) / (2 * length1 * clampedDist);
    const angle1 = Math.acos(Math.max(-1, Math.min(1, cosAngle1)));
    const baseAngle = Math.atan2(dy, dx);
    const jointAngle = baseAngle + angle1 * bendDirection;

    return {
        x: startX + Math.cos(jointAngle) * length1,
        y: startY + Math.sin(jointAngle) * length1
    };
}

// ============================================
// WALL RENDERER SYSTEM (Optimization)
// ============================================
class WallRenderer {
    constructor() {
        this.chunkSize = 512;
        this.chunks = new Map();
        this.resolution = 4; // Higher quality than before (was 8)
    }

    // Get or create chunk
    getChunk(chunkY, width) {
        if (!this.chunks.has(chunkY)) {
            this.generateChunk(chunkY, width);
        }
        return this.chunks.get(chunkY);
    }

    generateChunk(chunkY, width) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = this.chunkSize;
        const ctx = canvas.getContext('2d');
        const startY = chunkY * this.chunkSize;

        // Base fill
        ctx.fillStyle = CONFIG.wallColor;
        ctx.fillRect(0, 0, width, this.chunkSize);

        // Render noise
        for (let y = 0; y < this.chunkSize; y += this.resolution) {
            const worldY = startY + y;
            for (let x = 0; x < width; x += this.resolution) {
                const noiseVal = getGrabbabilityAt(x + this.resolution / 2, worldY + this.resolution / 2);

                if (noiseVal >= CONFIG.grabThreshold) {
                    // Normalize quality of hold
                    const quality = (noiseVal - CONFIG.grabThreshold) / (1 - CONFIG.grabThreshold);
                    const base = 60;
                    const highlight = Math.floor(quality * 100);

                    const r = base + highlight;
                    const g = base + highlight + 10;
                    const b = base + highlight;

                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    ctx.fillRect(x, y, this.resolution, this.resolution);
                } else {
                    // Unclimbable
                    const val = (noiseVal / CONFIG.grabThreshold);
                    const colorVal = 30 + Math.floor(val * 20);
                    const r = colorVal;
                    const g = colorVal + 5;
                    const b = colorVal + 10;
                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    ctx.fillRect(x, y, this.resolution, this.resolution);
                }
            }
        }
        this.chunks.set(chunkY, canvas);
    }

    draw(ctx, cameraY, viewportWidth, viewportHeight) {
        const startChunkY = Math.floor(cameraY / this.chunkSize);
        const endChunkY = Math.floor((cameraY + viewportHeight) / this.chunkSize);

        for (let cy = startChunkY; cy <= endChunkY; cy++) {
            const chunk = this.getChunk(cy, viewportWidth);
            const dstY = cy * this.chunkSize;
            ctx.drawImage(chunk, 0, dstY);
        }

        // Cleanup distant chunks to save memory
        for (const [key, _] of this.chunks) {
            if (key < startChunkY - 2 || key > endChunkY + 2) {
                this.chunks.delete(key);
            }
        }
    }

    clear() {
        this.chunks.clear();
    }
}

// ============================================
// GAME STATE & LOGIC
// ============================================

const wallRenderer = new WallRenderer();

let gameState = {
    camera: { y: 0 },
    selectedLimb: 'rightArm',
    mousePos: { x: 0, y: 0 },
    maxHeight: 0,
    bestHeight: 0,
    gameOver: false,
    falling: false,
    fallTimer: 0,
    onGround: true,
    keysPressed: {}
};

let player = {
    x: 0, y: 0, velocityY: 0,
    limbs: {
        leftArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
        rightArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
        leftLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false },
        rightLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false }
    }
};

function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);

    resetPlayerState();
    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    cameraXOffset = 0; // Not used yet but future proofing
    canvas.height = window.innerHeight;
    CONFIG.groundY = canvas.height - 50;
    wallRenderer.clear(); // Clear cache on resize
}

function resetPlayerState() {
    const standingHeight = CONFIG.torsoLength / 2 + CONFIG.upperLegLength + CONFIG.lowerLegLength - 20;
    player.x = canvas.width / 2;
    player.y = CONFIG.groundY - standingHeight;
    player.velocityY = 0;

    // Reset limbs
    player.limbs = {
        leftArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
        rightArm: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false },
        leftLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false },
        rightLeg: { x: 0, y: 0, grabbedAt: null, previousGrab: null, wasReleased: false, onGround: false }
    };

    initializeLimbs();

    // Reset Game State
    gameState = {
        camera: { y: 0 },
        selectedLimb: 'rightArm',
        mousePos: { x: 0, y: 0 },
        maxHeight: 0,
        bestHeight: gameState.bestHeight, // Preserve best height
        gameOver: false,
        falling: false,
        fallTimer: 0,
        onGround: true,
        keysPressed: {}
    };
    updateHUD();
}

function initializeLimbs() {
    const shoulderY = player.y - CONFIG.torsoLength / 2;
    player.limbs.leftArm.x = player.x - 40;
    player.limbs.leftArm.y = shoulderY + 20;
    player.limbs.rightArm.x = player.x + 40;
    player.limbs.rightArm.y = shoulderY + 20;

    player.limbs.leftLeg.x = player.x - 25;
    player.limbs.leftLeg.y = CONFIG.groundY;
    player.limbs.leftLeg.onGround = true;

    player.limbs.rightLeg.x = player.x + 25;
    player.limbs.rightLeg.y = CONFIG.groundY;
    player.limbs.rightLeg.onGround = true;
}

// ============================================
// INPUT HANDLING
// ============================================

function handleKeyDown(e) {
    if (gameState.gameOver) {
        if (e.code === 'Space') restartGame();
        return;
    }
    if (gameState.keysPressed[e.key]) return;

    const keyMap = { 'q': 'leftArm', 'Q': 'leftArm', 'e': 'rightArm', 'E': 'rightArm', 'a': 'leftLeg', 'A': 'leftLeg', 'd': 'rightLeg', 'D': 'rightLeg' };

    if (keyMap[e.key]) {
        const newLimb = keyMap[e.key];
        const previousLimb = gameState.selectedLimb;
        const limb = player.limbs[newLimb];

        if (newLimb !== previousLimb) {
            const prevLimbObj = player.limbs[previousLimb];
            prevLimbObj.wasReleased = false;
            prevLimbObj.previousGrab = null;
        }

        if (newLimb === previousLimb) {
            // Double press = Force Release
            limb.previousGrab = null;
            limb.wasReleased = false;
            if (limb.grabbedAt || limb.onGround) {
                limb.grabbedAt = null;
                limb.onGround = false;
            }
        } else {
            // Selection switch
            if (limb.grabbedAt) {
                limb.grabbedAt = null;
                limb.wasReleased = true;
            } else if (limb.onGround) {
                limb.onGround = false;
                limb.wasReleased = true;
            }
            limb.previousGrab = null;
        }
        gameState.selectedLimb = newLimb;
        updateHUD();
    }
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

    if (limb.grabbedAt || limb.onGround) {
        limb.grabbedAt = null;
        limb.onGround = false;
        limb.wasReleased = true;
        limb.previousGrab = null;
        updateHUD();
        return;
    }

    const stickiness = getGrabbabilityAt(limb.x, limb.y);
    if (stickiness >= CONFIG.grabThreshold) {
        if (gameState.selectedLimb.includes('Leg')) {
            const shoulderY = player.y - CONFIG.torsoLength / 2;
            if (limb.y < shoulderY) return; // Leg can't grab above shoulders
        }
        limb.grabbedAt = { x: limb.x, y: limb.y, stickiness };
        limb.wasReleased = false;
        limb.previousGrab = null;
        updateHUD();
    }
}

// ============================================
// LOGIC LOOPS
// ============================================

function gameLoop() {
    update();
    render();
    updateHUD();
    requestAnimationFrame(gameLoop);
}

function update() {
    if (gameState.gameOver) return;

    updateSelectedLimb();
    updateGroundMovement();
    updateFreeLimbs();

    const totalGrip = calculateTotalGrip();
    const feetOnGround = (player.limbs.leftLeg.onGround || player.limbs.rightLeg.onGround);

    // Slipping Logic
    if (totalGrip < CONFIG.playerWeight && !feetOnGround) {
        let attachedLimbs = [];
        for (const limbName in player.limbs) {
            const limb = player.limbs[limbName];
            if (limb.grabbedAt) attachedLimbs.push({ name: limbName, stickiness: limb.grabbedAt.stickiness });
        }
        if (attachedLimbs.length > 0) {
            attachedLimbs.sort((a, b) => a.stickiness - b.stickiness);
            const weakest = attachedLimbs[0];
            const deficit = CONFIG.playerWeight - totalGrip;
            const slipChance = 0.05 + (deficit * 0.1);
            if (Math.random() < slipChance) {
                player.limbs[weakest.name].grabbedAt = null;
                player.limbs[weakest.name].wasReleased = true;
            }
        }
    }

    // Falling Logic
    if (totalGrip < CONFIG.minGripToHold && !feetOnGround) {
        // Increment fall timer (Grace Period)
        gameState.fallTimer++;

        // Visual Instability (Wobble)
        player.x += (Math.random() - 0.5) * 4;
        player.y += (Math.random() - 0.5) * 4;

        if (gameState.fallTimer > CONFIG.fallGracePeriod) {
            // GRACE PERIOD OVER - FALL!
            gameState.falling = true;
            gameState.onGround = false;
            player.velocityY += CONFIG.gravity;
            player.velocityY = Math.min(player.velocityY, CONFIG.maxFallSpeed);
            player.y += player.velocityY;

            for (const limbName in player.limbs) {
                if (!player.limbs[limbName].grabbedAt) {
                    player.limbs[limbName].y += player.velocityY;
                }
            }
        }

        // Ground Collision (Safety check even during grace period)
        const feetY = player.y + CONFIG.torsoLength / 2 + CONFIG.upperLegLength + CONFIG.lowerLegLength;
        if (feetY >= CONFIG.groundY) {
            player.y = CONFIG.groundY - CONFIG.torsoLength / 2 - CONFIG.upperLegLength - CONFIG.lowerLegLength + 50;
            player.velocityY = 0;
            gameState.falling = false;
            gameState.fallTimer = 0;
            gameState.onGround = true;

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
        // Recovered Grip
        gameState.falling = false;
        gameState.fallTimer = 0;
        player.velocityY = 0;
        if (feetOnGround) {
            gameState.onGround = true;
            if (player.limbs.leftLeg.onGround) player.limbs.leftLeg.y = CONFIG.groundY;
            if (player.limbs.rightLeg.onGround) player.limbs.rightLeg.y = CONFIG.groundY;
        }
        updateBodyPosition();
    }

    updateCamera();

    updateCamera();

    // Height calculation: (GroundY - PlayerY) / 50 pixels per meter
    const currentHeight = Math.max(0, Math.floor((CONFIG.groundY - player.y - CONFIG.upperLegLength - CONFIG.lowerLegLength - CONFIG.torsoLength / 2) / 50));
    gameState.maxHeight = Math.max(gameState.maxHeight, currentHeight);
    gameState.bestHeight = Math.max(gameState.bestHeight, gameState.maxHeight);

    if (player.y > canvas.height + 500) triggerGameOver();
    updateGripMeter(totalGrip);
}

function updateSelectedLimb() {
    const limb = player.limbs[gameState.selectedLimb];
    if (!limb.grabbedAt && !limb.onGround) {
        const dx = gameState.mousePos.x - limb.x;
        const dy = gameState.mousePos.y - limb.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 5) {
            const speed = Math.min(CONFIG.limbReachSpeed, dist);
            limb.x += (dx / dist) * speed;
            limb.y += (dy / dist) * speed;
        }
        constrainLimbToBody(limb, gameState.selectedLimb);
    }
}

function updateGroundMovement() {
    if (!gameState.onGround) return;
    const moveSpeed = 3;
    let dx = 0;
    if (gameState.keysPressed['ArrowLeft'] || gameState.keysPressed['Left']) dx = -moveSpeed;
    else if (gameState.keysPressed['ArrowRight'] || gameState.keysPressed['Right']) dx = moveSpeed;

    if (dx !== 0) {
        player.x += dx;
        if (player.limbs.leftLeg.onGround) player.limbs.leftLeg.x += dx;
        if (player.limbs.rightLeg.onGround) player.limbs.rightLeg.x += dx;
        for (const limbName of ['leftArm', 'rightArm']) {
            if (!player.limbs[limbName].grabbedAt) player.limbs[limbName].x += dx;
        }
    }
}

function updateFreeLimbs() {
    for (const limbName in player.limbs) {
        const limb = player.limbs[limbName];
        if (limbName === gameState.selectedLimb || limb.grabbedAt || limb.onGround) continue;

        const isArm = limbName.includes('Arm');
        const isLeft = limbName.includes('left');
        const anchorY = isArm ? player.y - CONFIG.torsoLength / 2 : player.y + CONFIG.torsoLength / 2;
        const anchorX = player.x + (isLeft ? -10 : 10);
        const restOffsetX = isLeft ? -30 : 30;
        const restOffsetY = isArm ? 20 : 50;

        const naturalX = anchorX + restOffsetX;
        const naturalY = anchorY + restOffsetY;

        limb.x += (naturalX - limb.x) * 0.1;
        limb.y += (naturalY - limb.y) * 0.1;
        constrainLimbToBody(limb, limbName);
    }
}

function constrainLimbToBody(limb, limbName) {
    const isArm = limbName.includes('Arm');
    const anchorY = isArm ? player.y - CONFIG.torsoLength / 2 : player.y + CONFIG.torsoLength / 2;
    const anchorX = player.x + (limbName.includes('left') ? -10 : 10);
    const maxReach = isArm ? CONFIG.upperArmLength + CONFIG.lowerArmLength : CONFIG.upperLegLength + CONFIG.lowerLegLength;

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
    let points = 0;

    for (const limbName in player.limbs) {
        const limb = player.limbs[limbName];
        if (limb.grabbedAt) {
            total += limb.grabbedAt.stickiness;
            points++;
        }
        if (limb.onGround) {
            // Ground is solid
            total += 1.0;
            points++;
        }
    }

    // Stability Bonus: 3+ points of contact make you much more stable
    // This allows holding on to 3 "mediocre" holds without slipping
    if (points === 3) total *= 1.3;
    if (points === 4) total *= 1.5;

    return total;
}

function updateBodyPosition() {
    const leftArm = player.limbs.leftArm;
    const rightArm = player.limbs.rightArm;
    const leftLeg = player.limbs.leftLeg;
    const rightLeg = player.limbs.rightLeg;

    const legsAttached = leftLeg.grabbedAt || leftLeg.onGround || rightLeg.grabbedAt || rightLeg.onGround;
    const armsAttached = leftArm.grabbedAt || rightArm.grabbedAt;

    // Calculate Support Point Center
    let supportX = 0, supportY = 0, count = 0;
    if (leftLeg.grabbedAt || leftLeg.onGround) { supportX += leftLeg.x; supportY += leftLeg.y; count++; }
    if (rightLeg.grabbedAt || rightLeg.onGround) { supportX += rightLeg.x; supportY += rightLeg.y; count++; }
    if (count > 0) { supportX /= count; supportY /= count; }

    if (legsAttached) {
        // Stand up logic
        const legLength = CONFIG.upperLegLength + CONFIG.lowerLegLength;
        const idealBodyY = supportY - legLength - CONFIG.torsoLength / 2 + 20;
        const springStrength = 0.15;
        let targetY = idealBodyY;

        if (armsAttached) {
            let armX = 0, armY = 0, aCount = 0;
            if (leftArm.grabbedAt) { armX += leftArm.x; armY += leftArm.y; aCount++; }
            if (rightArm.grabbedAt) { armX += rightArm.x; armY += rightArm.y; aCount++; }
            if (aCount > 0) { armX /= aCount; armY /= aCount; }

            const armTargetY = armY + CONFIG.upperArmLength;
            targetY = Math.min(targetY, armTargetY); // Blend

            const targetX = (supportX + armX) / 2;
            player.x += (targetX - player.x) * 0.1;
        } else {
            player.x += (supportX - player.x) * 0.1;
        }
        player.y += (targetY - player.y) * springStrength;
    } else if (armsAttached) {
        // Hang logic
        let armX = 0, armY = 0, count = 0;
        if (leftArm.grabbedAt) { armX += leftArm.x; armY += leftArm.y; count++; }
        if (rightArm.grabbedAt) { armX += rightArm.x; armY += rightArm.y; count++; }
        if (count > 0) { armX /= count; armY /= count; }

        const hangDist = CONFIG.upperArmLength + CONFIG.lowerArmLength - 20;
        player.y += (armY + hangDist - player.y) * 0.1;
        player.x += (armX - player.x) * 0.1;
    }

    // Leaning logic
    const selectedLimb = player.limbs[gameState.selectedLimb];
    if (!selectedLimb.grabbedAt && !selectedLimb.onGround && legsAttached) {
        const leanFactor = 0.15;
        let leanAmount = (selectedLimb.x - player.x) * leanFactor;
        leanAmount = Math.max(-30, Math.min(30, leanAmount));
        player.x += (supportX + leanAmount - player.x) * 0.08;

        if (selectedLimb.y < player.y - 20) {
            // Reaching up extends body
            const extension = Math.min(1, Math.abs(selectedLimb.y - player.y) / 100);
            player.y -= extension * 2;
        }
    }

    // Constraints to Attached Limbs
    for (const limbName in player.limbs) {
        const limb = player.limbs[limbName];
        if (limb.grabbedAt) {
            limb.x = limb.grabbedAt.x;
            limb.y = limb.grabbedAt.y;
        }
    }

    // Iterative constraint solver for body reaching too far from limbs
    for (let i = 0; i < 3; i++) {
        for (const limbName in player.limbs) {
            const limb = player.limbs[limbName];
            if (limb.grabbedAt || limb.onGround) {
                const isArm = limbName.includes('Arm');
                const isLeft = limbName.includes('left');
                const anchorY = player.y + (isArm ? -CONFIG.torsoLength / 2 : CONFIG.torsoLength / 2);
                const anchorX = player.x + (isLeft ? -10 : 10);

                const maxLen = isArm ? (CONFIG.upperArmLength + CONFIG.lowerArmLength) : (CONFIG.upperLegLength + CONFIG.lowerLegLength);
                const dx = limb.x - anchorX;
                const dy = limb.y - anchorY;
                const dist = Math.hypot(dx, dy);

                if (dist > maxLen) {
                    const pullDist = dist - maxLen;
                    player.x += (dx / dist) * pullDist;
                    player.y += (dy / dist) * pullDist;
                }
            }
        }
    }
}

function updateCamera() {
    const targetCameraY = player.y - canvas.height / 2;
    gameState.camera.y += (targetCameraY - gameState.camera.y) * 0.05;
}

function triggerGameOver() {
    gameState.gameOver = true;
    const overlay = document.createElement('div');
    overlay.className = 'game-over';
    overlay.innerHTML = `<h1>FELL!</h1><p>Max Height: ${gameState.maxHeight}m</p><button onclick="restartGame()">Try Again</button>`;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('visible'), 10);
}

function restartGame() {
    const overlay = document.querySelector('.game-over');
    if (overlay) overlay.remove();
    wallRenderer.clear();
    resetPlayerState();
}
window.restartGame = restartGame;

// ============================================
// RENDERING
// ============================================

function render() {
    // Background (Wall)
    ctx.save();
    ctx.translate(0, -gameState.camera.y);

    // Draw Wall using cached chunks
    wallRenderer.draw(ctx, gameState.camera.y, canvas.width, canvas.height);

    // Draw Ground
    if (CONFIG.groundY > gameState.camera.y || CONFIG.groundY < gameState.camera.y + canvas.height + 100) {
        ctx.fillStyle = CONFIG.groundColor;
        ctx.fillRect(0, CONFIG.groundY, canvas.width, 200);
        ctx.fillStyle = CONFIG.groundTopColor;
        ctx.fillRect(0, CONFIG.groundY, canvas.width, 10);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        for (let x = 0; x < canvas.width; x += 40) {
            ctx.fillRect(x, CONFIG.groundY + 15, 20, 5);
            ctx.fillRect(x + 20, CONFIG.groundY + 35, 15, 5);
        }
    }

    // Draw Player
    drawPlayer();

    ctx.restore();

    // Vignette (Fixed on screen)
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(0.1, 'rgba(0,0,0,0)');
    grad.addColorStop(0.9, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawPlayer() {
    // Body Stick
    const headY = player.y - CONFIG.torsoLength / 2 - CONFIG.headRadius;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(player.x, player.y - CONFIG.torsoLength / 2);
    ctx.lineTo(player.x, player.y + CONFIG.torsoLength / 2);
    ctx.strokeStyle = CONFIG.stickFigureColor;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.arc(player.x, headY, CONFIG.headRadius, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.stickFigureColor;
    ctx.fill();

    // Face
    ctx.fillStyle = CONFIG.wallColor;
    ctx.beginPath();
    ctx.arc(player.x - 5, headY - 2, 3, 0, Math.PI * 2);
    ctx.arc(player.x + 5, headY - 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Limbs
    const limbs = ['leftLeg', 'rightLeg', 'leftArm', 'rightArm'];
    for (const limbName of limbs) {
        const limb = player.limbs[limbName];
        const isSelected = gameState.selectedLimb === limbName;
        const isAttached = limb.grabbedAt || limb.onGround;
        let color = isSelected ? CONFIG.selectedLimbColor : (isAttached ? CONFIG.attachedLimbColor : CONFIG.stickFigureColor);
        const alpha = isAttached || isSelected ? 1 : 0.7;

        drawLimb(limbName, limb, color, alpha);

        if (limb.grabbedAt) {
            ctx.beginPath();
            ctx.arc(limb.x, limb.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = CONFIG.attachedLimbColor;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(limb.x, limb.y, 8, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${limb.grabbedAt.stickiness})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Reach Indicator
    const selected = player.limbs[gameState.selectedLimb];
    if (!selected.grabbedAt) {
        ctx.beginPath();
        ctx.arc(selected.x, selected.y, 15, 0, Math.PI * 2);
        ctx.strokeStyle = CONFIG.selectedLimbColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawLimb(limbName, limb, color, alpha) {
    const isArm = limbName.includes('Arm');
    const isLeft = limbName.includes('left');
    const shoulderY = player.y - CONFIG.torsoLength / 2 + 5;
    const hipY = player.y + CONFIG.torsoLength / 2;
    const startX = player.x + (isLeft ? -10 : 10);
    const startY = isArm ? shoulderY : hipY;
    const upperLen = isArm ? CONFIG.upperArmLength : CONFIG.upperLegLength;
    const lowerLen = isArm ? CONFIG.lowerArmLength : CONFIG.lowerLegLength;

    const joint = calculateJoint(startX, startY, limb.x, limb.y, upperLen, lowerLen, isArm ? -1 : 1);

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(joint.x, joint.y);
    ctx.lineTo(limb.x, limb.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(joint.x, joint.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(limb.x, limb.y, isArm ? 6 : 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
}

function updateHUD() {
    document.querySelectorAll('.limb-control').forEach(el => {
        const limbName = el.dataset.limb;
        el.classList.toggle('active', limbName === gameState.selectedLimb);
        el.classList.toggle('attached', player.limbs[limbName]?.grabbedAt !== null);
    });

    // Consistent height calculation for display
    const currentRawHeight = Math.max(0, (CONFIG.groundY - player.y - CONFIG.upperLegLength - CONFIG.lowerLegLength - CONFIG.torsoLength / 2) / 50);
    const displayHeight = Math.floor(currentRawHeight);

    document.getElementById('heightDisplay').innerHTML = `
        <div class="current-height">Height: ${displayHeight}m</div>
        <div class="best-height">Best: ${gameState.bestHeight}m</div>
    `;
}

function updateGripMeter(grip) {
    const meterFill = document.getElementById('gripMeter');

    // If in grace period, calculate remaining time
    let percentage;
    if (gameState.fallTimer > 0) {
        // Flashing/Dropping effect based on remaining grace time
        const remainingFraction = 1 - (gameState.fallTimer / CONFIG.fallGracePeriod);
        percentage = remainingFraction * 100;
        meterFill.classList.add('danger'); // Force danger color
        meterFill.style.opacity = (Math.floor(Date.now() / 100) % 2 === 0) ? '1' : '0.5'; // Flash
    } else {
        percentage = Math.min(100, (grip / CONFIG.playerWeight) * 100);
        meterFill.style.opacity = '1';
        meterFill.classList.remove('warning', 'danger');
        if (percentage < 50) meterFill.classList.add('danger');
        else if (percentage < 100) meterFill.classList.add('warning');
    }

    meterFill.style.width = `${percentage}%`;
}

// Init Game
init();
