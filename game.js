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
    pathWidth: 250,           // [MODIFIED] Wider path for more playability

    // Grabbing & Difficulty
    grabThreshold: 0.15,      // Very lenient (can grab almost anything)

    // Grip Physics
    minGripToHold: 0.3,       // Lower threshold to avoid instant falling
    playerWeight: 0.95,       // Slightly easier to hold weight
    maxDisplayedGrip: 1.5,    // Grip amount that equals "100%" on the meter (1.5x body weight)
    fallGracePeriod: 60,      // Frames (~1 second) before falling when grip is lost
    maxGripInstability: 120,  // [NEW] Frames before slipping when grip is insufficient (~2s)

    // Stamina System
    maxStamina: 100,
    staminaDepletion: 0.3,    // Per frame (approx 5.5 seconds to empty from full hanging)
    staminaRegen: 1.0,        // Per frame (fast recovery when stable)

    // Ground
    groundY: 0, // Will be set based on canvas height

    // Colors
    wallColor: '#2d3436',
    wallPatternColor: '#636e72',
    stickFigureColor: '#ffffff',
    selectedLimbColor: '#667eea',
    attachedLimbColor: '#4caf50',
    groundColor: '#5d4e37',
    groundTopColor: '#8b7355',
    ropeColor: '#ff0055',
    pitonColor: '#b2bec3',
    maxPitons: 10,

    // New Winding Wall Config
    wallWidth: 700,
    wallMeanderScale: 0.0005, // Very low frequency for long sweeping curves
    wallMeanderAmp: 500       // How far it swings left/right (total range ~1000px)
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

function getWallCenter(y) {
    // 0 noise at y=0 naturally? Simplex returns range roughly -1 to 1.
    // We want the wall to start roughly centered at ground level.
    // y goes UP (negative in canvas coords usually? Wait. Game uses subtractive Y for height?)
    // Let's check player.y.
    // player.y starts at CONFIG.groundY.
    // Higher up means SMALLER y value.
    const noise = SimplexNoise.noise2D(0, y * CONFIG.wallMeanderScale);
    return (canvas.width / 2) + (noise * CONFIG.wallMeanderAmp);
}

function getGrabbabilityAt(x, y) {
    const wallCenterX = getWallCenter(y);
    const halfWidth = CONFIG.wallWidth / 2;

    // 1. Hard Boundary Check with Edge Falloff
    const distFromCenter = Math.min(Math.abs(x - wallCenterX), halfWidth + 100); // Clamp for safety
    if (distFromCenter > halfWidth) {
        return 0; // Completely air outside the strip
    }

    // Reuse path logic but relative to the Winding center
    // We can keep the "Golden Path" idea but it snakes INSIDE the snake.
    // Or we just make the whole snake climbable.
    // Let's make the center of the snake the "best" rock.

    const normalizedDist = distFromCenter / halfWidth; // 0 at center, 1 at edge
    let wallIntegrity = 1 - Math.pow(normalizedDist, 4); // Quartic falloff: Flat in middle, sharp drop at edges

    let value = 0;
    let amplitude = 1;
    let frequency = CONFIG.noiseScale;
    let maxValue = 0;

    for (let i = 0; i < CONFIG.noiseOctaves; i++) {
        let n = SimplexNoise.noise2D(x * frequency, y * frequency);
        n = 1 - Math.abs(n);
        n = n * n;
        value += amplitude * n;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 1.8;
    }

    let noiseVal = value / maxValue;

    // Hold Rarity
    noiseVal = Math.pow(noiseVal, 1.3);

    // Apply Wall Integrity (Edge mask)
    return noiseVal * wallIntegrity;
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

        // Clear Background (transparent)
        ctx.clearRect(0, 0, width, this.chunkSize);

        // Render noise with jittered sampling to remove grid lines
        for (let y = 0; y < this.chunkSize; y += this.resolution) {
            const worldY = startY + y;
            const wallCenterX = getWallCenter(worldY);
            const wallLeft = wallCenterX - CONFIG.wallWidth / 2;
            const wallRight = wallCenterX + CONFIG.wallWidth / 2;

            // Optimization: Only scan X within the wall bounds + padding
            // We align x to resolution grid
            let startX = Math.floor((wallLeft - 20) / this.resolution) * this.resolution;
            let endX = Math.ceil((wallRight + 20) / this.resolution) * this.resolution;
            startX = Math.max(0, startX);
            endX = Math.min(width, endX);

            for (let x = startX; x < width; x += this.resolution) {
                // Check bounds exactly
                if (x < wallLeft || x > wallRight) continue;

                // Jittered sampling
                const jitterX = (Math.random() - 0.5) * this.resolution;
                const jitterY = (Math.random() - 0.5) * this.resolution;

                const noiseVal = getGrabbabilityAt(x + this.resolution / 2 + jitterX, worldY + this.resolution / 2 + jitterY);

                if (noiseVal >= CONFIG.grabThreshold) {
                    const quality = (noiseVal - CONFIG.grabThreshold) / (1 - CONFIG.grabThreshold);

                    const baseR = 45, baseG = 52, baseB = 54;

                    // Add secondary microscopic noise for texture dusting
                    const dusting = (Math.random() - 0.5) * 10;
                    const brightness = 8 + Math.floor(quality * 35) + dusting;

                    const r = Math.max(0, Math.min(255, baseR + brightness));
                    const g = Math.max(0, Math.min(255, baseG + brightness + 3));
                    const b = Math.max(0, Math.min(255, baseB + brightness + 4));

                    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    // Slight randomized overlaps break grid lines
                    const drawW = this.resolution + (Math.random() * 2);
                    const drawH = this.resolution + (Math.random() * 2);
                    ctx.fillRect(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, drawW, drawH);
                } else {
                    // Wall Background (Non-grabbable rock)
                    // We render this explicitely now since we cleared the canvas
                    // Only draw inside the wall strip
                    const baseC = 30;
                    ctx.fillStyle = `rgb(${baseC}, ${baseC + 2}, ${baseC + 4})`;
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
            const dstY = cy * this.chunkSize - cameraY; // Adjust for camera
            const dstX = -gameState.camera.x; // Shift left by camera X
            ctx.drawImage(chunk, dstX, dstY);
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
// BACKGROUND RENDERER SYSTEM
// ============================================
class BackgroundRenderer {
    constructor() {
        this.stars = [];
        this.clouds = [];
        this.hills = [];
        this.trees = [];
        this.initElements();
    }

    initElements() {
        // Space Stars (High Alt)
        for (let i = 0; i < 200; i++) {
            this.stars.push({
                x: Math.random() * canvas.width * 2, // Wider for parallax
                y: -(Math.random() * 5000) - 2000,
                size: Math.random() * 2,
                alpha: Math.random()
            });
        }

        // Clouds (Mid-High Alt)
        for (let i = 0; i < 20; i++) {
            this.clouds.push({
                x: Math.random() * canvas.width * 2, // Wider for parallax
                y: -Math.random() * 3000 + CONFIG.groundY - 500,
                width: 100 + Math.random() * 200,
                height: 40 + Math.random() * 40,
                depth: 0.2 + Math.random() * 0.3 // Parallax Factor
            });
        }

        // Hills (Mid Alt)
        for (let i = 0; i < 15; i++) {
            this.hills.push({
                x: Math.random() * canvas.width * 2,
                y: CONFIG.groundY - Math.random() * 500 - 100,
                width: 300 + Math.random() * 500,
                height: 200 + Math.random() * 300,
                depth: 0.1 + Math.random() * 0.2, // Distant hill
                color: `hsl(${100 + Math.random() * 40}, 30%, ${30 + Math.random() * 20}%)`
            });
        }

        // Trees (Low Alt) - Only near ground
        for (let i = 0; i < 50; i++) {
            this.trees.push({
                x: (Math.random() - 0.5) * canvas.width * 3 + canvas.width / 2,
                y: CONFIG.groundY,
                height: 50 + Math.random() * 100,
                width: 20 + Math.random() * 20,
                depth: 0.05 + Math.random() * 0.1, // Near bg
                color: `hsl(${100 + Math.random() * 30}, 40%, ${20 + Math.random() * 15}%)`
            });
        }
    }

    draw(ctx, cameraX, cameraY) {
        const height = canvas.height;
        const groundLevel = CONFIG.groundY;
        const skyHeight = 5000; // Height where it becomes full space

        // 1. Sky Gradient Calculation
        // Calculate center of view height relative to ground
        const viewHeight = groundLevel - (cameraY + height / 2);

        // Blend colors based on height
        // Low: Blue (#87CEEB) -> Mid: Dark Blue (#191970) -> High: Black (#000000)
        let r, g, b;

        if (viewHeight < 1000) {
            // Blue to Dark Blue
            const t = Math.min(1, Math.max(0, viewHeight / 1000));
            r = Math.floor(135 * (1 - t) + 25 * t);
            g = Math.floor(206 * (1 - t) + 25 * t);
            b = Math.floor(235 * (1 - t) + 112 * t);
        } else {
            // Dark Blue to Black
            const t = Math.min(1, Math.max(0, (viewHeight - 1000) / 2000));
            r = Math.floor(25 * (1 - t) + 0 * t);
            g = Math.floor(25 * (1 - t) + 0 * t);
            b = Math.floor(112 * (1 - t) + 0 * t);
        }

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, canvas.width, height);

        // 2. Stars
        if (viewHeight > 500) {
            const starAlphaBase = Math.min(1, (viewHeight - 500) / 1000);
            ctx.fillStyle = 'white';
            this.stars.forEach(star => {
                // Simple parallax for stars (very slow)
                const px = star.x - cameraX * 0.02;
                const py = star.y - cameraY * 0.02;

                // Wrap X for infinite feel
                const wrapW = canvas.width * 2;
                const drawnX = ((px % wrapW) + wrapW) % wrapW - canvas.width * 0.5;
                const drawnY = py - cameraY + height; // Relative to screen?, wait.
                // Just draw fixed relative to camera for simplicity.
                // Actually stars should be almost fixed on screen?
                // Let's use simple drawing:

                // Draw relative to camera with parallax
                const sX = star.x - cameraX * 0.01;
                const sY = star.y - cameraY * 0.01;

                // Wrap stars horizontally
                const wrappedX = ((sX % canvas.width) + canvas.width) % canvas.width;

                // Only draw if on screen (Y calculation tricky with infinite scroll? Stars are at fixed World Y)
                // World Y for star is star.y. Screen Y = star.y - camera.y.
                const screenY = star.y - cameraY;

                if (screenY > -10 && screenY < height + 10) {
                    ctx.globalAlpha = star.alpha * starAlphaBase;
                    ctx.beginPath();
                    ctx.arc(wrappedX, screenY, star.size, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
            ctx.globalAlpha = 1.0;
        }

        // 3. Hills (Mid/Background)
        this.hills.forEach(hill => {
            const px = hill.x - cameraX * hill.depth;
            const py = hill.y - cameraY * hill.depth; // Parallax Y too? Maybe relative to horizon.
            // Usually Y parallax is tricky if ground is fixed.
            // Let's keep Y fixed relative to world ground.
            const screenY = hill.y - cameraY;

            // Wrap X
            const wrapW = canvas.width * 3;
            const drawnX = ((px % wrapW) + wrapW) % wrapW - canvas.width;

            if (screenY + hill.height > 0 && screenY < height) {
                ctx.fillStyle = hill.color;
                ctx.beginPath();
                ctx.moveTo(drawnX, screenY + hill.height); // Bottom left (ish)
                ctx.lineTo(drawnX + hill.width / 2, screenY); // Peak
                ctx.lineTo(drawnX + hill.width, screenY + hill.height); // Bottom right
                ctx.fill();
            }
        });

        // 4. Clouds
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        this.clouds.forEach(cloud => {
            const px = cloud.x - cameraX * cloud.depth;
            const screenY = cloud.y - cameraY;

            // Wrap X
            const wrapW = canvas.width * 3;
            const drawnX = ((px % wrapW) + wrapW) % wrapW - canvas.width;

            if (screenY + cloud.height > 0 && screenY < height) {
                ctx.beginPath();
                ctx.ellipse(drawnX, screenY, cloud.width / 2, cloud.height / 2, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // 5. Trees (Foreground-ish background)
        this.trees.forEach(tree => {
            const px = tree.x - cameraX * tree.depth; // Move slower than wall
            const screenY = tree.y - cameraY - tree.height; // Tree base at groundY

            // No wrapping for trees, they are local to start area
            const drawnX = px;

            if (drawnX > -100 && drawnX < canvas.width + 100 && screenY < height && screenY + tree.height > 0) {
                // Trunk
                ctx.fillStyle = '#4e342e';
                ctx.fillRect(drawnX - tree.width / 4, screenY + tree.height * 0.6, tree.width / 2, tree.height * 0.4);

                // Leaves (Triangle)
                ctx.fillStyle = tree.color;
                ctx.beginPath();
                ctx.moveTo(drawnX - tree.width, screenY + tree.height * 0.8);
                ctx.lineTo(drawnX, screenY);
                ctx.lineTo(drawnX + tree.width, screenY + tree.height * 0.8);
                ctx.fill();
            }
        });
    }
}

const backgroundRenderer = new BackgroundRenderer();

// ============================================
// GAME STATE & LOGIC
// ============================================

const wallRenderer = new WallRenderer();

let gameState = {
    camera: { x: 0, y: 0 }, // [MODIFIED] Added X support
    selectedLimb: 'rightArm',
    mousePos: { x: 0, y: 0 },
    maxHeight: 0,
    bestHeight: 0,
    stamina: 100, // [NEW] Starts full
    gameOver: false,
    falling: false,
    dangling: false,
    fallTimer: 0,
    gripInstability: 0, // [NEW] Accumulates when grip is low
    onGround: true,
    keysPressed: {},
    pitons: []
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
        camera: { x: 0, y: 0 },
        selectedLimb: 'rightArm',
        mousePos: { x: 0, y: 0 },
        maxHeight: 0,
        bestHeight: gameState.bestHeight, // Preserve best height
        stamina: 100,
        gameOver: false,
        falling: false,
        dangling: false,
        fallTimer: 0,
        gripInstability: 0,
        onGround: true,
        keysPressed: {},
        pitons: []
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

    // Prevent repeat for all keys handled below
    if (gameState.keysPressed[e.key]) return;

    const keyMap = { 'q': 'leftArm', 'Q': 'leftArm', 'e': 'rightArm', 'E': 'rightArm', 'a': 'leftLeg', 'A': 'leftLeg', 'd': 'rightLeg', 'D': 'rightLeg' };

    // Piton Placement
    if (e.code === 'KeyS' || e.key === 's' || e.key === 'S') {
        if (!gameState.falling && !gameState.gameOver) {
            placePiton();
        }
        // Fall through to mark key as pressed
    }

    // Resume / Unclip (Space)
    if (e.code === 'Space') {
        if (gameState.dangling) {
            gameState.dangling = false;
            player.velocityY = 0;
            updateHUD();
        }
    }

    else if (keyMap[e.key]) {
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
    gameState.mousePos.x = e.clientX + gameState.camera.x;
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

        // Recover from dangling if we grab something
        // BUT only if we are stable! Handled in update() now.
        updateHUD();
    }
}

// ============================================
// LOGIC LOOPS
// ============================================

// ============================================

function gameLoop() {
    update();
    render();
    updateHUD();
    drawStaminaBar(); // [NEW] Draw stamina UI
    requestAnimationFrame(gameLoop);
}

function update() {
    if (gameState.gameOver) return;

    updateSelectedLimb();
    updateGroundMovement();
    updateFreeLimbs();

    const totalGrip = calculateTotalGrip();

    // If dangling, we are safe but hanging. Skip falling logic.
    if (gameState.dangling) {
        // Visualize Rope Support
        if (gameState.pitons.length > 0) {
            const lastPiton = gameState.pitons[gameState.pitons.length - 1];

            // Swing towards piton X (Pendulum effect)
            const targetX = lastPiton.x;
            player.x += (targetX - player.x) * 0.05;

            // Maintain height roughly below piton
            const targetY = lastPiton.y + 80;
            // Strong pull to target height if falling below it, gentle drift if above
            if (player.y > targetY) {
                player.y += (targetY - player.y) * 0.1;
                player.velocityY = 0;
            }
        }

        player.velocityY *= 0.9;

        // Auto-recover removed. User must press Space/Y to resume.

        // Stop dangling if we touch ground
        if (player.y >= CONFIG.groundY - 100) {
            gameState.dangling = false;
        }
        updateCamera();
        return;
    }

    const feetOnGround = (player.limbs.leftLeg.onGround || player.limbs.rightLeg.onGround);

    // ============================
    // STAMINA SYSTEM
    // ============================
    let pointsOfContact = 0;
    if (player.limbs.leftArm.grabbedAt) pointsOfContact++;
    if (player.limbs.rightArm.grabbedAt) pointsOfContact++;
    if (player.limbs.leftLeg.grabbedAt || player.limbs.leftLeg.onGround) pointsOfContact++;
    if (player.limbs.rightLeg.grabbedAt || player.limbs.rightLeg.onGround) pointsOfContact++;

    if (pointsOfContact === 4 || feetOnGround) {
        // Safe & Stable (or on ground) -> Regenerate
        gameState.stamina = Math.min(CONFIG.maxStamina, gameState.stamina + CONFIG.staminaRegen);
    } else {
        // Exertion -> Deplete
        gameState.stamina = Math.max(0, gameState.stamina - CONFIG.staminaDepletion);
    }

    // Stamina Failure (Muscle Failure)
    if (gameState.stamina <= 0) {
        // Force hands to release if they are holding on
        if (player.limbs.leftArm.grabbedAt) {
            player.limbs.leftArm.grabbedAt = null;
            player.limbs.leftArm.wasReleased = true;
        }
        if (player.limbs.rightArm.grabbedAt) {
            player.limbs.rightArm.grabbedAt = null;
            player.limbs.rightArm.wasReleased = true;
        }
        // This will naturally trigger the falling logic in the next frame if feet aren't enough
    }

    // Slipping Logic (Grip Fatigue)
    if (totalGrip < CONFIG.playerWeight && !feetOnGround) {
        // Grip is insufficient! Instability increases.
        gameState.gripInstability += 1;

        // Visual Instability (Shake)
        const shake = (gameState.gripInstability / CONFIG.maxGripInstability) * 3;
        player.x += (Math.random() - 0.5) * shake;
        player.y += (Math.random() - 0.5) * shake;

        if (gameState.gripInstability > CONFIG.maxGripInstability) {
            // FATIGUE LIMIT REACHED - FORCE SLIP
            let attachedLimbs = [];
            for (const limbName in player.limbs) {
                const limb = player.limbs[limbName];
                if (limb.grabbedAt) attachedLimbs.push({ name: limbName, stickiness: limb.grabbedAt.stickiness });
            }
            if (attachedLimbs.length > 0) {
                attachedLimbs.sort((a, b) => a.stickiness - b.stickiness); // Sort by weakest
                const weakest = attachedLimbs[0];

                // Slip the weakest limb
                player.limbs[weakest.name].grabbedAt = null;
                player.limbs[weakest.name].wasReleased = true;

                // Reset instability partially to give a chance to recover before next slip
                gameState.gripInstability = CONFIG.maxGripInstability * 0.5;
            }
        }
    } else {
        // Grip is good. Recover logic.
        if (gameState.gripInstability > 0) {
            gameState.gripInstability -= 2; // Recover twice as fast as you tire
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

            // ROPE CATCH LOGIC (Lead Fall)
            if (gameState.pitons.length > 0) {
                const lastPiton = gameState.pitons[gameState.pitons.length - 1];

                // If player was above piton, they fall distance = (playerY - pitonY) * 2 roughly
                // But we simplify: The rope length is fixed based on the HIGHEST point reached since last piton?
                // Actually simpler: Rope catches when Distance(Piton, Player) > Slack.
                // WE simulate slack: Slack is distance from piton to highest point reached, OR just current distance?
                // Common game simplification: Catches if you fall Y distance > 2 * (StartFallY - PitonY).

                // Let's us a springy catch.
                // Ideally, if you are at Y=100 and Piton is Y=200 (100m below). Rope logic irrelevant.
                // If you are at Y=200 and Piton is Y=300 (100m below). You fall past 300 to 400.

                // Current simple implementation:
                // Calculate 'rope length' as distance between player and piton when the fall *started*?
                // No, lead climbing means slack is paid out.
                // Let's assuming the rope is just tight enough to reach the player's current position.
                // If player moves DOWN, rope goes taut.

                // Wait, if I'm falling, I am moving down.
                // Catch condition: Player is BELOW the last piton AND distance > fallDistance?

                if (player.y > lastPiton.y) {
                    // Player is below the piton.
                    const fallDistance = player.y - lastPiton.y;

                    // Catch faster (shorter rope)
                    if (fallDistance > 80) {
                        // CATCH!
                        player.y = lastPiton.y + 80;
                        player.velocityY *= -0.3; // Less bounce
                        if (Math.abs(player.velocityY) < 1) {
                            player.velocityY = 0;
                            gameState.falling = false;
                            gameState.dangling = true; // Enter safe dangling state
                            gameState.fallTimer = 0;   // Reset danger timer
                        }
                    }
                }
            }

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

function drawStaminaBar() {
    // Draw Stamina Bar near the player
    const barWidth = 60;
    const barHeight = 8;
    const x = (player.x - gameState.camera.x) - barWidth / 2;
    // [FIX] Convert world Y to screen Y by subtracting camera.y
    const y = (player.y - gameState.camera.y) - 70; // Above head

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, barWidth, barHeight);

    // Fill
    const pct = gameState.stamina / CONFIG.maxStamina;

    // Color gradient
    if (pct > 0.5) ctx.fillStyle = '#00e676'; // Green
    else if (pct > 0.25) ctx.fillStyle = '#ffea00'; // Yellow
    else ctx.fillStyle = '#ff1744'; // Red

    ctx.fillRect(x, y, barWidth * pct, barHeight);

    // Border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barWidth, barHeight);
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
    // Vertical tracking
    const targetY = player.y - canvas.height * 0.6;
    gameState.camera.y += (targetY - gameState.camera.y) * 0.1;

    // Horizontal tracking
    const targetX = player.x - canvas.width / 2;
    gameState.camera.x += (targetX - gameState.camera.x) * 0.1;

    // Limit Camera Y so we don't go below ground
    if (gameState.camera.y + canvas.height > CONFIG.groundY + 100) {
        gameState.camera.y = CONFIG.groundY + 100 - canvas.height;
    }
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
    // 1. Draw Background
    backgroundRenderer.draw(ctx, gameState.camera.x, gameState.camera.y);

    // Wall Renderer
    ctx.save();
    // Translate for camera. 
    // WallRenderer now handles its own X translation internally via drawImage args?
    // Let's check wallRenderer.draw logic.
    // It does ctx.drawImage(chunk, -gameState.camera.x, dstY);
    // So we should NOT translate X here if the renderer does it relative to 0.
    // But we need to translate Y?
    // WallRenderer logic: 
    // const dstY = cy * this.chunkSize - cameraY;
    // So WallRenderer handles BOTH X and Y subtraction.
    // So we do NOT need ctx.translate here for the wall.

    // HOWEVER, the wallRenderer chunks are drawn.
    wallRenderer.draw(ctx, gameState.camera.y, canvas.width, canvas.height);

    ctx.restore();

    // Context for WORLD objects (Player, Rope, Pitons etc)
    // These are stored in World Coordinates.
    // So we need to translate by (-camera.x, -camera.y)
    ctx.save();
    ctx.translate(-gameState.camera.x, -gameState.camera.y);


    // Draw Ground
    if (CONFIG.groundY > gameState.camera.y || CONFIG.groundY < gameState.camera.y + canvas.height + 100) {
        ctx.fillStyle = CONFIG.groundColor;
        ctx.fillRect(-10000, CONFIG.groundY, 20000, 200); // Infinite ground width
        ctx.fillStyle = CONFIG.groundTopColor;
        ctx.fillRect(-10000, CONFIG.groundY, 20000, 10);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';

        // Grass loops (world coordinates)
        // Draw some decorative grass near the player
        const playerChunk = Math.floor(player.x / 1000) * 1000;
        for (let x = playerChunk - 2000; x < playerChunk + 2000; x += 40) {
            ctx.fillRect(x, CONFIG.groundY + 15, 20, 5);
            ctx.fillRect(x + 20, CONFIG.groundY + 35, 15, 5);
        }
    }

    // Draw Player and Rope
    drawRope();
    drawPitons();
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
        ctx.moveTo(selected.x, selected.y);
        ctx.lineTo(gameState.mousePos.x, gameState.mousePos.y);
        ctx.strokeStyle = `rgba(255, 255, 255, 0.3)`;
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
        <div style="font-size: 10px; color: #888; margin-top: 4px">Pitons: ${gameState.pitons.length}/${CONFIG.maxPitons}</div>
        ${gameState.dangling ? '<div style="color: #4caf50; font-size: 11px; margin-top: 4px; animation: pulse 1s infinite">DANGLING<br>Press SPACE to Resume</div>' : ''}
    `;
}

function placePiton() {
    const newPiton = { x: player.x, y: player.y - 20 }; // Place slightly above center mass
    gameState.pitons.push(newPiton);
    if (gameState.pitons.length > CONFIG.maxPitons) {
        gameState.pitons.shift();
    }
    updateHUD();
}

function drawPitons() {
    ctx.fillStyle = CONFIG.pitonColor;
    for (const p of gameState.pitons) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        // Ring
        ctx.strokeStyle = '#7f8c8d';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

function drawRope() {
    ctx.strokeStyle = CONFIG.ropeColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    // Start at ground center
    let startX = canvas.width / 2;
    let startY = CONFIG.groundY;
    ctx.moveTo(startX, startY);

    // Through all pitons
    for (const p of gameState.pitons) {
        ctx.lineTo(p.x, p.y);
        startX = p.x;
        startY = p.y;
    }

    // To Player
    // Calculate bezier curve for slack if not falling and climbing up
    const endX = player.x;
    const endY = player.y;

    if (!gameState.falling && !gameState.gameOver) {
        // Add Slack (curve downward)
        // Control point is midpoint + drop
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2 + 50; // 50px hanging slack
        ctx.quadraticCurveTo(midX, midY, endX, endY);
    } else {
        // Taut when falling
        ctx.lineTo(endX, endY);
    }

    ctx.stroke();
}

function updateGripMeter(grip) {
    const meterContainer = document.querySelector('.meter-bar');
    const meterFill = document.getElementById('gripMeter');

    // Scale: 0 to CONFIG.playerWeight * 1.5
    // 100% = 1.5x body weight (Super secure)
    // Threshold = 1.0x body weight (Slipping point)
    const maxScale = CONFIG.playerWeight * 1.5;
    const percentage = Math.min(100, (grip / maxScale) * 100);
    const slipThresholdPct = (1 / 1.5) * 100; // ~66%

    // Add visual marker for threshold if not exists
    let thresholdLine = document.getElementById('gripThresholdLine');
    if (!thresholdLine) {
        thresholdLine = document.createElement('div');
        thresholdLine.id = 'gripThresholdLine';
        thresholdLine.style.position = 'absolute';
        thresholdLine.style.left = `${slipThresholdPct}%`;
        thresholdLine.style.top = '0';
        thresholdLine.style.bottom = '0';
        thresholdLine.style.width = '2px';
        thresholdLine.style.backgroundColor = 'rgba(255,255,255,0.8)';
        thresholdLine.style.zIndex = '10';
        thresholdLine.title = "Minimum Grip to Avoid Slipping";

        // Ensure parent is relative
        meterContainer.style.position = 'relative';
        meterContainer.appendChild(thresholdLine);
    }

    // If in grace period, calculate remaining time
    if (gameState.fallTimer > 0) {
        // Flashing/Dropping effect based on remaining grace time
        const remainingFraction = 1 - (gameState.fallTimer / CONFIG.fallGracePeriod);
        const flashPct = remainingFraction * 100; // Shrink to 0

        meterFill.classList.add('danger'); // Force danger color
        meterFill.style.opacity = (Math.floor(Date.now() / 100) % 2 === 0) ? '1' : '0.5'; // Flash
        meterFill.style.width = `${flashPct}%`;
    } else {
        meterFill.style.opacity = '1';
        meterFill.style.width = `${percentage}%`;
        meterFill.classList.remove('warning', 'danger');

        // Color logic
        if (percentage < (CONFIG.minGripToHold / maxScale * 100)) {
            meterFill.classList.add('danger'); // Falling (Red)
        } else if (grip < CONFIG.playerWeight) {
            meterFill.classList.add('warning'); // Slipping (Orange/Yellow)
        } else {
            // Good grip (Green)
        }
    }
}

// Init Game
init();
