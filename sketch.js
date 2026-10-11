
let video, hands;

let isProcessing = false;
let wristPoint = null;
let handLandmarks = null;
let wristInZone = false;

const MAIN_WIDTH = 640;
const MAIN_HEIGHT = 480;

const PREVIEW_X = 660;
const PREVIEW_Y = 0;
const PREVIEW_WIDTH = 200;
const PREVIEW_HEIGHT = 150;

const WRIST_ZONE_WIDTH = 80;
const WRIST_ZONE_HEIGHT = 120;
const WRIST_ZONE_Y = 350;

const SAMPLE_WIDTH = 320;
const SAMPLE_HEIGHT = 240;

const DIFFERENCE_THRESHOLD = 35;
const MASK_PADDING = 7;

const PAPER = [242, 238, 225];
const INK = [48, 41, 38];

const TRACE_INK = [100, 92, 84];
const TRACE_OPACITY = 155;
const TRACE_WEIGHT = 0.85;

let paperLayer;
let traceLayer;
let cameraSample;
let previousFrame = null;

let sessionState = "ready";

let startButton;
let finishButton;
let clearButton;
let saveButton;

let fingertipPath = [];
let revealIndex = 0;

const revealSpeed = 3;

let lastTrackedPoint = null;
let lastTraceTimestamp = 0;

const TRACE_MIN_DISTANCE = 2;
const TRACE_MAX_DISTANCE = 65;
const TRACE_SAMPLE_INTERVAL = 30;
const TRACE_SMOOTHING = 0.35;

let smoothedPoint = null;

// ------------------------------------
// STATUS
// ------------------------------------

function setStatus(message) {
  const element = document.getElementById("status");

  if (element && element.textContent !== message) {
    element.textContent = message;
  }
}

// ------------------------------------
// SETUP
// ------------------------------------

function setup() {
  const canvas = createCanvas(880, 480);
  canvas.parent("app");

  pixelDensity(1);

  video = createCapture(VIDEO);
  video.size(MAIN_WIDTH, MAIN_HEIGHT);
  video.hide();

  paperLayer = createGraphics(
    MAIN_WIDTH,
    MAIN_HEIGHT
  );
  paperLayer.pixelDensity(1);
  paperLayer.background(...PAPER);

  traceLayer = createGraphics(
    MAIN_WIDTH,
    MAIN_HEIGHT
  );
  traceLayer.pixelDensity(1);
  traceLayer.clear();

  cameraSample = createGraphics(
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT
  );
  cameraSample.pixelDensity(1);

  startButton = createButton("Start");
  startButton.parent("controls");
  startButton.mousePressed(startSession);

  finishButton = createButton("Finish");
  finishButton.parent("controls");
  finishButton.mousePressed(finishSession);

  clearButton = createButton("Clear");
  clearButton.parent("controls");
  clearButton.mousePressed(resetSession);

  saveButton = createButton("Save");
  saveButton.parent("controls");
  saveButton.mousePressed(saveArtwork);

  hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  hands.onResults(onHandResults);

  setStatus("Press Start");
}

// ------------------------------------
// SESSION CONTROLS
// ------------------------------------

function resetSession() {
  sessionState = "ready";

  paperLayer.background(...PAPER);
  traceLayer.clear();

  previousFrame = null;

  fingertipPath = [];
  revealIndex = 0;

  lastTrackedPoint = null;
  smoothedPoint = null;
  lastTraceTimestamp = 0;

  setStatus("Press Start");
}

function startSession() {
  resetSession();
  sessionState = "recording";
  setStatus("Move wrist into box");
}

function finishSession() {
  if (sessionState !== "recording") return;

  sessionState = "revealing";

  previousFrame = null;
  lastTrackedPoint = null;
  smoothedPoint = null;

  revealIndex = 0;
  traceLayer.clear();

  setStatus("Revealing fingertip path");
}

function saveArtwork() {
  const artwork = createGraphics(
    MAIN_WIDTH,
    MAIN_HEIGHT
  );

  artwork.pixelDensity(1);
  artwork.image(paperLayer, 0, 0);
  artwork.image(traceLayer, 0, 0);

  saveCanvas(
    artwork.canvas,
    "one-fixed-point",
    "png"
  );

  artwork.remove();
}

// ------------------------------------
// HAND TRACKING
// ------------------------------------

function breakFingertipPath() {
  lastTrackedPoint = null;
  smoothedPoint = null;

  if (
    fingertipPath.length > 0 &&
    fingertipPath[fingertipPath.length - 1] !== null
  ) {
    fingertipPath.push(null);
  }
}

function onHandResults(results) {
  wristPoint = null;
  handLandmarks = null;
  wristInZone = false;

  if (
    !results.multiHandLandmarks ||
    !results.multiHandedness
  ) {
    previousFrame = null;

    if (sessionState === "recording") {
      breakFingertipPath();
      setStatus("Show your left hand");
    }
    return;
  }

  for (
    let i = 0;
    i < results.multiHandLandmarks.length;
    i++
  ) {
    const landmarks = results.multiHandLandmarks[i];
    const label = results.multiHandedness[i].label;

    const actualHand =
      label === "Left" ? "Right" : "Left";

    if (actualHand !== "Left") continue;

    handLandmarks = landmarks;

    const wrist = landmarks[0];
    const wristX = (1 - wrist.x) * MAIN_WIDTH;
    const wristY = wrist.y * MAIN_HEIGHT;

    wristPoint = {
      x: wristX,
      y: wristY
    };

    wristInZone =
      abs(wristX - MAIN_WIDTH / 2) <
        WRIST_ZONE_WIDTH / 2 &&
      abs(wristY - WRIST_ZONE_Y) <
        WRIST_ZONE_HEIGHT / 2;

    if (sessionState === "recording") {
      if (wristInZone) {
        setStatus("Recording");

        const tip = landmarks[12];

        recordFingertip(
          (1 - tip.x) * MAIN_WIDTH,
          tip.y * MAIN_HEIGHT
        );
      } else {
        setStatus("Move wrist into box");
        previousFrame = null;
        breakFingertipPath();
      }
    }

    return;
  }

  previousFrame = null;

  if (sessionState === "recording") {
    breakFingertipPath();
    setStatus("Show your left hand");
  }
}

async function detectHands() {
  if (
    isProcessing ||
    !video ||
    video.elt.readyState < 2
  ) return;

  isProcessing = true;

  try {
    await hands.send({
      image: video.elt
    });
  } catch (error) {
    console.error(error);

    wristInZone = false;
    previousFrame = null;

    if (sessionState === "recording") {
      breakFingertipPath();
      setStatus("Tracking error");
    }
  } finally {
    isProcessing = false;
  }
}

// ------------------------------------
// RECORD MIDDLE FINGERTIP
// ------------------------------------

function recordFingertip(x, y) {
  if (sessionState !== "recording") return;

  const now = millis();

  if (
    now - lastTraceTimestamp <
    TRACE_SAMPLE_INTERVAL
  ) return;

  const rawPoint = { x, y };

  if (lastTrackedPoint) {
    const jump = dist(
      rawPoint.x,
      rawPoint.y,
      lastTrackedPoint.x,
      lastTrackedPoint.y
    );

    if (jump > TRACE_MAX_DISTANCE) {
      breakFingertipPath();
    }
  }

  lastTrackedPoint = rawPoint;

  if (!smoothedPoint) {
    smoothedPoint = { x, y };
  } else {
    smoothedPoint = {
      x: lerp(
        smoothedPoint.x,
        x,
        TRACE_SMOOTHING
      ),
      y: lerp(
        smoothedPoint.y,
        y,
        TRACE_SMOOTHING
      )
    };
  }

  const point = {
    x: smoothedPoint.x,
    y: smoothedPoint.y
  };

  const previous =
    fingertipPath.length > 0
      ? fingertipPath[fingertipPath.length - 1]
      : null;

  if (previous) {
    const movement = dist(
      point.x,
      point.y,
      previous.x,
      previous.y
    );

    if (movement < TRACE_MIN_DISTANCE) {
      return;
    }
  }

  fingertipPath.push(point);
  lastTraceTimestamp = now;
}

// ------------------------------------
// HAND MASK
// ------------------------------------

function getHandPoints() {
  if (!handLandmarks) return [];

  return handLandmarks.map((p) => ({
    x: (1 - p.x) * SAMPLE_WIDTH,
    y: p.y * SAMPLE_HEIGHT
  }));
}

function createHandMask(points) {
  const mask = new Uint8Array(
    SAMPLE_WIDTH * SAMPLE_HEIGHT
  );

  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17], [5, 17]
  ];

  for (const [a, b] of connections) {
    const p1 = points[a];
    const p2 = points[b];

    const distance = dist(
      p1.x, p1.y,
      p2.x, p2.y
    );

    const steps = max(1, ceil(distance));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;

      const x = lerp(p1.x, p2.x, t);
      const y = lerp(p1.y, p2.y, t);

      const radius = MASK_PADDING;

      const minX = max(0, floor(x - radius));
      const maxX = min(
        SAMPLE_WIDTH - 1,
        ceil(x + radius)
      );

      const minY = max(0, floor(y - radius));
      const maxY = min(
        SAMPLE_HEIGHT - 1,
        ceil(y + radius)
      );

      for (let yy = minY; yy <= maxY; yy++) {
        for (let xx = minX; xx <= maxX; xx++) {
          if (
            dist(xx, yy, x, y) <= radius
          ) {
            mask[
              yy * SAMPLE_WIDTH + xx
            ] = 1;
          }
        }
      }
    }
  }

  return mask;
}

// ------------------------------------
// FRAME DIFFERENCING + SCRATCH
// ------------------------------------

function recordFrameDifference() {
  if (
    sessionState !== "recording" ||
    !wristInZone ||
    !handLandmarks
  ) {
    previousFrame = null;
    return;
  }

  cameraSample.push();

  cameraSample.translate(SAMPLE_WIDTH, 0);
  cameraSample.scale(-1, 1);

  cameraSample.image(
    video,
    0,
    0,
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT
  );

  cameraSample.pop();
  cameraSample.loadPixels();

  const currentFrame =
    new Uint8ClampedArray(
      cameraSample.pixels
    );

  if (!previousFrame) {
    previousFrame = currentFrame;
    return;
  }

  const points = getHandPoints();
  const handMask = createHandMask(points);

  const total =
    SAMPLE_WIDTH * SAMPLE_HEIGHT;

  const sx = MAIN_WIDTH / SAMPLE_WIDTH;
  const sy = MAIN_HEIGHT / SAMPLE_HEIGHT;

  for (let i = 0; i < total; i++) {
    if (!handMask[i]) continue;

    const p = i * 4;

    const difference =
      (
        abs(currentFrame[p] - previousFrame[p]) +
        abs(currentFrame[p + 1] - previousFrame[p + 1]) +
        abs(currentFrame[p + 2] - previousFrame[p + 2])
      ) / 3;

    if (
      difference <= DIFFERENCE_THRESHOLD
    ) continue;

    const x = i % SAMPLE_WIDTH;
    const y = floor(i / SAMPLE_WIDTH);

    const px = x * sx;
    const py = y * sy;

    const alpha = map(
      difference,
      DIFFERENCE_THRESHOLD,
      255,
      3,
      100,
      true
    );

    paperLayer.stroke(
      ...INK,
      alpha * 0.35
    );

    paperLayer.strokeWeight(
      random(0.3, 0.8)
    );

    const angle = random(-0.6, 0.6);
    const length = random(2, 6);

    paperLayer.line(
      px - cos(angle) * length / 2,
      py - sin(angle) * length / 2,
      px + cos(angle) * length / 2,
      py + sin(angle) * length / 2
    );
  }

  previousFrame = currentFrame;
}

// ------------------------------------
// SMOOTH FINGERTIP TRACE
// ------------------------------------

function drawCurveSegment(index) {
  const p1 = fingertipPath[index - 1];
  const p2 = fingertipPath[index];

  if (!p1 || !p2) return;

  const p0 =
    index >= 2 &&
    fingertipPath[index - 2]
      ? fingertipPath[index - 2]
      : p1;

  const p3 =
    index + 1 < fingertipPath.length &&
    fingertipPath[index + 1]
      ? fingertipPath[index + 1]
      : p2;

  traceLayer.noFill();

  traceLayer.stroke(
    ...TRACE_INK,
    TRACE_OPACITY
  );

  traceLayer.strokeWeight(TRACE_WEIGHT);
  traceLayer.strokeCap(ROUND);
  traceLayer.strokeJoin(ROUND);

  traceLayer.beginShape();

  traceLayer.curveVertex(p0.x, p0.y);
  traceLayer.curveVertex(p1.x, p1.y);
  traceLayer.curveVertex(p2.x, p2.y);
  traceLayer.curveVertex(p3.x, p3.y);

  traceLayer.endShape();
}

function revealFingertipPath() {
  if (sessionState !== "revealing") return;

  for (let i = 0; i < revealSpeed; i++) {
    if (revealIndex >= fingertipPath.length) {
      sessionState = "finished";

      // Keep this message until Start is pressed again.
      setStatus("Revealing fingertip path");
      return;
    }

    if (revealIndex > 0) {
      drawCurveSegment(revealIndex);
    }

    revealIndex++;
  }
}

// ------------------------------------
// DRAW
// ------------------------------------

function draw() {
  background(228, 222, 210);

  if (
    video &&
    video.elt.readyState >= 2
  ) {
    recordFrameDifference();
  }

  revealFingertipPath();

  image(
    paperLayer,
    0,
    0,
    MAIN_WIDTH,
    MAIN_HEIGHT
  );

  image(
    traceLayer,
    0,
    0,
    MAIN_WIDTH,
    MAIN_HEIGHT
  );

  // Mirrored camera preview
  push();

  translate(
    PREVIEW_X + PREVIEW_WIDTH,
    PREVIEW_Y
  );

  scale(-1, 1);

  image(
    video,
    0,
    0,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT
  );

  pop();

  // Camera border
  noFill();
  stroke(145, 135, 124);
  strokeWeight(1);

  rect(
    PREVIEW_X,
    PREVIEW_Y,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT
  );

  // Wrist positioning box
  const zoneX =
    PREVIEW_X +
    (
      MAIN_WIDTH / 2 -
      WRIST_ZONE_WIDTH / 2
    ) * PREVIEW_WIDTH / MAIN_WIDTH;

  const zoneY =
    PREVIEW_Y +
    (
      WRIST_ZONE_Y -
      WRIST_ZONE_HEIGHT / 2
    ) * PREVIEW_HEIGHT / MAIN_HEIGHT;

  const zoneW =
    WRIST_ZONE_WIDTH *
    PREVIEW_WIDTH / MAIN_WIDTH;

  const zoneH =
    WRIST_ZONE_HEIGHT *
    PREVIEW_HEIGHT / MAIN_HEIGHT;

  strokeWeight(2);

  stroke(
    wristInZone
      ? color(80, 150, 105)
      : color(180, 100, 90)
  );

  noFill();

  rect(
    zoneX,
    zoneY,
    zoneW,
    zoneH
  );

  // White wrist tracking dot
  if (wristPoint) {
    const wx =
      PREVIEW_X +
      wristPoint.x *
      PREVIEW_WIDTH / MAIN_WIDTH;

    const wy =
      PREVIEW_Y +
      wristPoint.y *
      PREVIEW_HEIGHT / MAIN_HEIGHT;

    stroke(65, 55, 48);
    strokeWeight(1.5);
    fill(255);

    circle(wx, wy, 10);
  }

  detectHands();
}
