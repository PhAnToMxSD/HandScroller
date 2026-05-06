import * as pdfjsLib from "./node_modules/pdfjs-dist/legacy/build/pdf.min.mjs";

const pdfFileInput = document.getElementById("pdfFile");
const fileName = document.getElementById("fileName");
const startCameraButton = document.getElementById("startCamera");
const stopCameraButton = document.getElementById("stopCamera");
const cameraStatus = document.getElementById("cameraStatus");
const gestureStatus = document.getElementById("gestureStatus");
const cameraVideo = document.getElementById("cameraVideo");
const overlayCanvas = document.getElementById("overlayCanvas");
const handDot = document.getElementById("handDot");
const cameraEmpty = document.getElementById("cameraEmpty");
const pdfViewport = document.getElementById("pdfViewport");
const pdfPages = document.getElementById("pdfPages");
const pdfEmpty = document.getElementById("pdfEmpty");
const pdfFullscreenToggle = document.getElementById("pdfFullscreenToggle");
const pdfZoomOutButton = document.getElementById("pdfZoomOut");
const pdfZoomInButton = document.getElementById("pdfZoomIn");
const pdfZoomResetButton = document.getElementById("pdfZoomReset");
const pdfZoomValue = document.getElementById("pdfZoomValue");
const documentPanel = document.querySelector(".document-panel");

pdfjsLib.GlobalWorkerOptions.workerSrc = "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";

const state = {
  pdfDoc: null,
  pdfSourceBytes: null,
  pdfLabel: "",
  pendingPdfScrollRatio: 0,
  pdfZoom: 1,
  pdfRenderInProgress: false,
  pdfRerenderQueued: false,
  pdfRenderGeneration: 0,
  camera: null,
  hands: null,
  handY: null,
  scrollVelocity: 0,
  lastTick: performance.now(),
  streamActive: false,
  lastHandSeenAt: 0,
};

async function getCameraPermissionState() {
  if (!navigator.permissions?.query) {
    return "unknown";
  }

  try {
    const result = await navigator.permissions.query({ name: "camera" });
    return result.state;
  } catch {
    return "unknown";
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStatus(element, text, tone) {
  element.textContent = text;
  element.classList.remove("neutral", "live", "warn", "error");
  element.classList.add(tone);
}

function updateCameraEmpty(visible) {
  cameraEmpty.classList.toggle("hidden", !visible);
}

function updateFullscreenButton() {
  const fullscreenActive = document.fullscreenElement === documentPanel;
  pdfFullscreenToggle.textContent = fullscreenActive ? "Exit fullscreen" : "Fullscreen";
}

function updateZoomDisplay() {
  pdfZoomValue.textContent = `${Math.round(state.pdfZoom * 100)}%`;
}

function setDocumentControlsDisabled(disabled) {
  pdfZoomOutButton.disabled = disabled;
  pdfZoomInButton.disabled = disabled;
  pdfZoomResetButton.disabled = disabled;
  pdfFullscreenToggle.disabled = disabled;
}

function syncOverlaySize() {
  const rect = cameraVideo.getBoundingClientRect();
  const devicePixelRatio = window.devicePixelRatio || 1;
  overlayCanvas.width = Math.round(rect.width * devicePixelRatio);
  overlayCanvas.height = Math.round(rect.height * devicePixelRatio);
  overlayCanvas.style.width = `${rect.width}px`;
  overlayCanvas.style.height = `${rect.height}px`;
}

function clearOverlay() {
  const context = overlayCanvas.getContext("2d");
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  handDot.style.opacity = 0;
}

async function renderPdf(arrayBuffer, fileLabel, preserveScrollRatio = 0) {
  const renderGeneration = ++state.pdfRenderGeneration;
  state.pdfRenderInProgress = true;
  setDocumentControlsDisabled(true);

  try {
    setStatus(cameraStatus, "Camera idle", "neutral");
    fileName.textContent = fileLabel;
    state.pdfSourceBytes = arrayBuffer instanceof Uint8Array ? arrayBuffer.slice() : new Uint8Array(arrayBuffer).slice();
    state.pdfLabel = fileLabel;

    pdfEmpty.hidden = true;
    pdfPages.hidden = false;
    pdfPages.innerHTML = "";

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(state.pdfSourceBytes) });
    state.pdfDoc = await loadingTask.promise;

    const totalPages = state.pdfDoc.numPages;
    const viewportWidth = pdfViewport.clientWidth - 44;

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      if (renderGeneration !== state.pdfRenderGeneration) {
        return;
      }

      const page = await state.pdfDoc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.max(0.35, Math.min(4, (viewportWidth / baseViewport.width) * state.pdfZoom));
      const viewport = page.getViewport({ scale });

      const pageWrap = document.createElement("article");
      pageWrap.className = "pdf-page";

      const pageLabel = document.createElement("div");
      pageLabel.className = "pdf-page-label";
      pageLabel.textContent = `Page ${pageNumber}`;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const devicePixelRatio = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * devicePixelRatio);
      canvas.height = Math.floor(viewport.height * devicePixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.scale(devicePixelRatio, devicePixelRatio);

      pageWrap.append(pageLabel, canvas);
      pdfPages.append(pageWrap);

      await page.render({ canvasContext: context, viewport }).promise;
    }

    if (renderGeneration !== state.pdfRenderGeneration) {
      return;
    }

    pdfViewport.scrollTop = 0;
    const maxScrollTop = Math.max(0, pdfViewport.scrollHeight - pdfViewport.clientHeight);
    pdfViewport.scrollTop = Math.round(maxScrollTop * preserveScrollRatio);
    setStatus(gestureStatus, "Waiting for a hand", "neutral");
    updateZoomDisplay();
  } finally {
    if (renderGeneration === state.pdfRenderGeneration) {
      state.pdfRenderInProgress = false;
      setDocumentControlsDisabled(false);

      if (state.pdfRerenderQueued) {
        state.pdfRerenderQueued = false;
        void rerenderPdfPreservingScroll();
      }
    }
  }
}

async function rerenderPdfPreservingScroll() {
  if (!state.pdfSourceBytes || !state.pdfLabel) {
    return;
  }

  if (state.pdfRenderInProgress) {
    state.pdfRerenderQueued = true;
    return;
  }

  const maxScrollTop = Math.max(0, pdfViewport.scrollHeight - pdfViewport.clientHeight);
  state.pendingPdfScrollRatio = maxScrollTop > 0 ? pdfViewport.scrollTop / maxScrollTop : 0;
  await renderPdf(state.pdfSourceBytes, state.pdfLabel, state.pendingPdfScrollRatio);
}

function setPdfZoom(nextZoom) {
  state.pdfZoom = clamp(nextZoom, 0.5, 3);
  updateZoomDisplay();
}

async function zoomPdfBy(delta) {
  setPdfZoom(state.pdfZoom + delta);
  await rerenderPdfPreservingScroll();
}

async function resetPdfZoom() {
  setPdfZoom(1);
  await rerenderPdfPreservingScroll();
}

async function togglePdfFullscreen() {
  const maxScrollTop = Math.max(0, pdfViewport.scrollHeight - pdfViewport.clientHeight);
  state.pendingPdfScrollRatio = maxScrollTop > 0 ? pdfViewport.scrollTop / maxScrollTop : 0;

  if (document.fullscreenElement === documentPanel) {
    await document.exitFullscreen();
    return;
  }

  await documentPanel.requestFullscreen();
}

function drawOverlay(landmarks) {
  const context = overlayCanvas.getContext("2d");
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!landmarks.length) {
    handDot.style.opacity = 0;
    return;
  }

  const width = overlayCanvas.width;
  const height = overlayCanvas.height;

  handDot.style.left = `${((1 - landmarks[0].x) * 100).toFixed(2)}%`;
  handDot.style.top = `${(landmarks[0].y * 100).toFixed(2)}%`;
  handDot.style.opacity = 1;

  context.save();
  context.strokeStyle = "rgba(104, 225, 253, 0.85)";
  context.fillStyle = "rgba(104, 225, 253, 0.9)";
  context.lineWidth = Math.max(2, Math.round(width * 0.004));

  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17], [5, 9], [9, 13], [13, 17],
  ];

  connections.forEach(([start, end]) => {
    const from = landmarks[start];
    const to = landmarks[end];
    context.beginPath();
    context.moveTo(from.x * width, from.y * height);
    context.lineTo(to.x * width, to.y * height);
    context.stroke();
  });

  landmarks.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x * width, point.y * height, index === 0 ? 6 : 4, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
}

function distanceSquared(pointA, pointB) {
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;
  return dx * dx + dy * dy;
}

function isFingerCurled(landmarks, tipIndex, pipIndex, wrist) {
  const tipDistance = distanceSquared(landmarks[tipIndex], wrist);
  const pipDistance = distanceSquared(landmarks[pipIndex], wrist);
  return tipDistance < pipDistance * 0.92;
}

function detectHandPose(landmarks) {
  const wrist = landmarks[0];
  const fingerGroups = [
    [4, 2],
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ];

  const curledCount = fingerGroups.reduce((count, [tipIndex, pipIndex]) => {
    return count + (isFingerCurled(landmarks, tipIndex, pipIndex, wrist) ? 1 : 0);
  }, 0);

  if (curledCount >= 4) {
    return "fist";
  }

  if (curledCount <= 1) {
    return "open";
  }

  return "neutral";
}

function updateScrollVelocity(pose) {
  const inertia = 420;

  if (pose === "open") {
    state.scrollVelocity = -inertia;
    setStatus(gestureStatus, "Open hand: scroll up", "warn");
    return;
  }

  if (pose === "fist") {
    state.scrollVelocity = inertia;
    setStatus(gestureStatus, "Fist: scroll down", "warn");
    return;
  }

  state.scrollVelocity = 0;
  setStatus(gestureStatus, "Hold a fist or open hand", "live");
}

async function startCamera() {
  if (state.streamActive) {
    return;
  }

  const cameraPermissionState = await getCameraPermissionState();
  if (cameraPermissionState === "denied") {
    setStatus(cameraStatus, "Camera blocked in browser settings", "error");
    setStatus(
      gestureStatus,
      "Allow camera access for this page in Safari/Chrome settings, then try again",
      "error",
    );
    updateCameraEmpty(true);
    return;
  }

  syncOverlaySize();
  updateCameraEmpty(false);

  state.hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  state.hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });

  state.hands.onResults((results) => {
    const landmarks = results.multiHandLandmarks?.[0] ?? [];

    if (!landmarks.length) {
      state.scrollVelocity = 0;
      if (performance.now() - state.lastHandSeenAt > 1000) {
        setStatus(gestureStatus, "Waiting for a hand", "neutral");
      }
      clearOverlay();
      return;
    }

    state.lastHandSeenAt = performance.now();
    drawOverlay(landmarks);
    updateScrollVelocity(detectHandPose(landmarks));
  });

  state.camera = new Camera(cameraVideo, {
    onFrame: async () => {
      await state.hands.send({ image: cameraVideo });
    },
    width: 1280,
    height: 720,
  });

  try {
    await state.camera.start();
    state.streamActive = true;
    setStatus(cameraStatus, "Camera live", "live");
    startCameraButton.disabled = true;
    stopCameraButton.disabled = false;
  } catch (error) {
    console.error(error);
    state.streamActive = false;
    if (error?.name === "NotAllowedError") {
      setStatus(cameraStatus, "Camera permission denied", "error");
      setStatus(
        gestureStatus,
        "Allow camera access for this page in browser and macOS privacy settings",
        "error",
      );
    } else {
      setStatus(cameraStatus, "Camera unavailable", "error");
      setStatus(gestureStatus, "Check camera hardware and permissions", "error");
    }
    updateCameraEmpty(true);
  }
}

async function stopCamera() {
  if (!state.streamActive) {
    return;
  }

  if (state.camera?.stop) {
    state.camera.stop();
  }

  const stream = cameraVideo.srcObject;
  if (stream && typeof stream.getTracks === "function") {
    stream.getTracks().forEach((track) => track.stop());
  }

  cameraVideo.srcObject = null;
  state.streamActive = false;
  state.hands = null;
  state.camera = null;
  state.handY = null;
  state.scrollVelocity = 0;
  clearOverlay();
  updateCameraEmpty(true);
  setStatus(cameraStatus, "Camera idle", "neutral");
  setStatus(gestureStatus, "Waiting for a hand", "neutral");
  startCameraButton.disabled = false;
  stopCameraButton.disabled = true;
}

function tick(now) {
  const delta = (now - state.lastTick) / 1000;
  state.lastTick = now;

  if (state.scrollVelocity !== 0) {
    const nextTop = clamp(
      pdfViewport.scrollTop + state.scrollVelocity * delta,
      0,
      Math.max(0, pdfViewport.scrollHeight - pdfViewport.clientHeight),
    );
    pdfViewport.scrollTop = nextTop;
  }

  requestAnimationFrame(tick);
}

pdfFileInput.addEventListener("change", async () => {
  const [file] = pdfFileInput.files ?? [];
  if (!file) {
    return;
  }

  try {
    setPdfZoom(1);
    fileName.textContent = file.name;
    const buffer = await file.arrayBuffer();
    await renderPdf(buffer, file.name);
  } catch (error) {
    console.error(error);
    setStatus(cameraStatus, "PDF load failed", "error");
    pdfEmpty.hidden = false;
    pdfPages.hidden = true;
  }
});

startCameraButton.addEventListener("click", startCamera);
stopCameraButton.addEventListener("click", stopCamera);
pdfZoomOutButton.addEventListener("click", () => {
  void zoomPdfBy(-0.1);
});
pdfZoomInButton.addEventListener("click", () => {
  void zoomPdfBy(0.1);
});
pdfZoomResetButton.addEventListener("click", () => {
  void resetPdfZoom();
});
pdfFullscreenToggle.addEventListener("click", togglePdfFullscreen);

document.addEventListener("fullscreenchange", () => {
  updateFullscreenButton();
  void rerenderPdfPreservingScroll();
});

window.addEventListener("resize", () => {
  syncOverlaySize();
});

cameraVideo.addEventListener("loadedmetadata", syncOverlaySize);

setStatus(cameraStatus, "Camera idle", "neutral");
setStatus(gestureStatus, "Waiting for a hand", "neutral");
updateCameraEmpty(true);
updateFullscreenButton();
updateZoomDisplay();
getCameraPermissionState().then((stateValue) => {
  if (stateValue === "denied") {
    setStatus(cameraStatus, "Camera blocked in browser settings", "error");
    setStatus(
      gestureStatus,
      "Enable camera access for this page, then click Start camera again",
      "error",
    );
  }
});
requestAnimationFrame(tick);