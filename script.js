const video = document.getElementById("cameraPreview");
const shutterButton = document.getElementById("shutterButton");
const switchCameraButton = document.getElementById("switchCameraButton");
const cameraModeLabel = document.getElementById("cameraModeLabel");
const photoCount = document.getElementById("photoCount");
const progress = document.getElementById("filmProgress");
const cameraMessage = document.getElementById("cameraMessage");
const cameraSubMessage = document.getElementById("cameraSubMessage");
const shootStatus = document.getElementById("shootStatus");

const developArea = document.getElementById("developArea");
const developButton = document.getElementById("developButton");
const developingScreen = document.getElementById("developingScreen");
const resultsArea = document.getElementById("resultsArea");
const negativeStrip = document.getElementById("negativeStrip");
const exportButton = document.getElementById("exportButton");

const modeButtons = document.querySelectorAll(".mode-button");
const layoutButtons = document.querySelectorAll(".layout-button");

const MAX_PHOTOS = 12;

let db = null;
let memoryPhotos = [];
let photos = [];
let photoTotal = 0;
let cameraStream = null;
let currentFacingMode = "environment"; // "environment" = 背面, "user" = 前面
let currentMode = "negative";
let currentLayout = "six";
let developing = false;
let developed = false;

// DATABASE (応答が詰まらないようタイムアウト＆メモリ保存フォールバック付き)

function openDatabase() {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => resolve(null), 1500);

    try {
      const request = indexedDB.open("ROLL12Database", 1);

      request.onupgradeneeded = () => {
        request.result.createObjectStore("photos", {
          keyPath: "id",
          autoIncrement: true
        });
      };

      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };

      request.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };

      request.onblocked = () => {
        clearTimeout(timer);
        resolve(null);
      };
    } catch (e) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function getAllPhotos() {
  if (!db) return Promise.resolve([...memoryPhotos]);

  return new Promise((resolve) => {
    try {
      const request = db.transaction("photos", "readonly")
        .objectStore("photos").getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([...memoryPhotos]);
    } catch (e) {
      resolve([...memoryPhotos]);
    }
  });
}

function savePhoto(imageData) {
  const item = {
    image: imageData,
    createdAt: new Date().toISOString()
  };

  if (!db) {
    memoryPhotos.push(item);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction("photos", "readwrite");
      transaction.objectStore("photos").add(item);
      transaction.oncomplete = resolve;
      transaction.onerror = () => {
        memoryPhotos.push(item);
        resolve();
      };
    } catch (e) {
      memoryPhotos.push(item);
      resolve();
    }
  });
}

function clearAllPhotos() {
  memoryPhotos = [];
  if (!db) return Promise.resolve();

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction("photos", "readwrite");
      transaction.objectStore("photos").clear();
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    } catch (e) {
      resolve();
    }
  });
}

// CAMERA

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
}

async function startCamera() {
  shutterButton.disabled = true;
  if (switchCameraButton) switchCameraButton.disabled = true;

  try {
    if (!window.isSecureContext) {
      throw new Error("HTTPS REQUIRED");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("CAMERA NOT SUPPORTED");
    }

    cameraSubMessage.textContent = "ACCESSING CAMERA...";
    stopCameraStream();

    // Safariがvideoの読み込みを止めないよう先に表示状態にする
    video.style.display = "block";
    video.setAttribute("playsinline", "");
    video.muted = true;

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: currentFacingMode
      },
      audio: false
    });

    video.srcObject = cameraStream;

    const isFront = currentFacingMode === "user";
    video.classList.toggle("mirror", isFront);
    if (cameraModeLabel) {
      cameraModeLabel.textContent = isFront ? "FRONT" : "REAR";
    }

    cameraSubMessage.textContent = "LOADING VIDEO...";

    // loadedmetadata が発火しない端末でも止まらないよう1.2秒で次へ進む
    await new Promise((resolve) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      const fallbackTimer = setTimeout(resolve, 1200);
      video.onloadedmetadata = () => {
        clearTimeout(fallbackTimer);
        resolve();
      };
    });

    await video.play();

    cameraMessage.textContent = "READY";
    cameraSubMessage.textContent = "FRAME " +
      String(photoTotal + 1).padStart(2, "0");

    shutterButton.disabled = false;
    if (switchCameraButton) switchCameraButton.disabled = false;
    shootStatus.textContent = "CAMERA READY";

  } catch (error) {
    console.error(error);
    if (switchCameraButton) switchCameraButton.disabled = false;

    if (error.message === "HTTPS REQUIRED") {
      cameraMessage.textContent = "HTTPS REQUIRED";
      cameraSubMessage.textContent = "OPEN VIA HTTPS URL";
      shootStatus.textContent = "SAFARI REQUIRES HTTPS FOR CAMERA";
    } else if (error.name === "NotAllowedError") {
      cameraMessage.textContent = "PERMISSION DENIED";
      cameraSubMessage.textContent = "ALLOW CAMERA IN SETTINGS";
      shootStatus.textContent = "CAMERA ACCESS BLOCKED";
    } else {
      cameraMessage.textContent = "CAMERA ERROR";
      cameraSubMessage.textContent = error.name || "CHECK CAMERA";
      shootStatus.textContent = "TAP SWITCH OR RELOAD";
    }
  }
}

async function switchCamera() {
  if (photoTotal >= MAX_PHOTOS) return;

  currentFacingMode =
    currentFacingMode === "environment" ? "user" : "environment";

  cameraMessage.textContent = "SWITCHING...";
  cameraSubMessage.textContent =
    currentFacingMode === "user" ? "FRONT CAMERA" : "REAR CAMERA";
  shootStatus.textContent = "SWITCHING CAMERA...";

  await startCamera();
}

async function takePhoto() {
  if (!cameraStream || photoTotal >= MAX_PHOTOS) return;

  if (!video.videoWidth || !video.videoHeight) {
    shootStatus.textContent = "CAMERA WARMING UP...";
    return;
  }

  shutterButton.disabled = true;
  if (switchCameraButton) switchCameraButton.disabled = true;
  shootStatus.textContent = "CAPTURING...";

  try {
    const canvas = document.createElement("canvas");
    const maxDimension = 1600;
    const scale = Math.min(
      1,
      maxDimension / Math.max(video.videoWidth, video.videoHeight)
    );

    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext("2d");

    if (currentFacingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    if (!dataUrl || dataUrl === "data:,") {
      throw new Error("PHOTO CAPTURE FAILED");
    }

    await savePhoto(dataUrl);

    photoTotal++;
    updateDisplay();

    if (photoTotal < MAX_PHOTOS) {
      shutterButton.disabled = false;
      if (switchCameraButton) switchCameraButton.disabled = false;
      shootStatus.textContent = "PHOTO SAVED";
    }

  } catch (error) {
    console.error(error);
    shootStatus.textContent = "SAVE FAILED: " + (error.message || "TRY AGAIN");
    shutterButton.disabled = false;
    if (switchCameraButton) switchCameraButton.disabled = false;
  }
}

// COUNTER

function updateDisplay() {
  photoCount.textContent =
    String(photoTotal).padStart(2, "0") + " / 12";

  Array.from(progress.children).forEach((frame, index) => {
    frame.classList.toggle("taken", index < photoTotal);
  });

  if (photoTotal >= MAX_PHOTOS) {
    cameraMessage.textContent = "ROLL COMPLETE";
    cameraSubMessage.textContent = "READY TO DEVELOP";
    shootStatus.textContent = "12 FRAMES EXPOSED";
    shutterButton.disabled = true;
    if (switchCameraButton) switchCameraButton.disabled = true;
    developArea.hidden = false;

    stopCameraStream();
  } else {
    cameraSubMessage.textContent =
      "FRAME " + String(photoTotal + 1).padStart(2, "0");
  }
}

// IMAGE PROCESSING

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    if (typeof source === "string") {
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    } else {
      const url = URL.createObjectURL(source);
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = reject;
      image.src = url;
    }
  });
}

async function createProcessedImage(source, mode) {
  const image = await loadImage(source);

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  context.drawImage(image, 0, 0);

  if (mode === "scan") {
    context.filter = "saturate(1.08) contrast(1.04) sepia(0.05)";
    context.drawImage(image, 0, 0);
    context.filter = "none";

  } else {
    const imageData = context.getImageData(
      0, 0, canvas.width, canvas.height
    );

    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      pixels[i] = Math.min(255, (255 - r) * 0.92 + 25);
      pixels[i + 1] = Math.min(255, (255 - g) * 0.88 + 10);
      pixels[i + 2] = Math.min(255, (255 - b) * 0.80 + 3);
    }

    context.putImageData(imageData, 0, 0);
  }

  return canvas.toDataURL("image/jpeg", 0.95);
}

// FILM FRAME

function renderFilm() {
  negativeStrip.innerHTML = "";
  negativeStrip.className =
    "negative-strip layout-" + currentLayout +
    " mode-" + currentMode;

  const memoryHeader = document.createElement("div");
  memoryHeader.className = "memory-header";

  const lineLeft = document.createElement("span");
  lineLeft.className = "memory-line-left";

  const title = document.createElement("span");
  title.className = "memory-title";
  title.textContent = "Memory";

  const lineRight = document.createElement("span");
  lineRight.className = "memory-line-right";

  memoryHeader.appendChild(lineLeft);
  memoryHeader.appendChild(title);
  memoryHeader.appendChild(lineRight);
  negativeStrip.appendChild(memoryHeader);

  const scrollWrapper = document.createElement("div");
  scrollWrapper.className = "film-scroll-wrapper";

  const filmSheet = document.createElement("div");
  filmSheet.className = "film-sheet";

  const topRail = document.createElement("div");
  topRail.className = "film-rail-top";
  filmSheet.appendChild(topRail);

  const columns =
    currentLayout === "strip" ? 12 :
    currentLayout === "six" ? 6 : 4;

  for (let start = 0; start < photos.length; start += columns) {
    if (start > 0) {
      const seam = document.createElement("div");
      seam.className = "film-seam";
      filmSheet.appendChild(seam);
    }

    const rowPhotos = photos.slice(start, start + columns);
    const framesGrid = document.createElement("div");
    framesGrid.className = "film-frames-grid";

    rowPhotos.forEach((photo, idx) => {
      const frameIndex = start + idx;

      const frame = document.createElement("div");
      frame.className = "film-frame";

      const image = document.createElement("img");
      image.src = photo.processed;
      image.alt = "Frame " + (frameIndex + 1);

      frame.appendChild(image);
      framesGrid.appendChild(frame);
    });

    filmSheet.appendChild(framesGrid);
  }

  const bottomRail = document.createElement("div");
  bottomRail.className = "film-rail-bottom";
  filmSheet.appendChild(bottomRail);

  scrollWrapper.appendChild(filmSheet);
  negativeStrip.appendChild(scrollWrapper);
}

// DEVELOP

async function developFilm() {
  if (developing || developed || photoTotal !== MAX_PHOTOS) return;

  developing = true;
  developArea.hidden = true;
  developingScreen.hidden = false;

  try {
    const savedPhotos = await getAllPhotos();

    if (savedPhotos.length !== MAX_PHOTOS) {
      throw new Error("EXPECTED 12 PHOTOS");
    }

    photos = [];

    for (const photo of savedPhotos) {
      const negative = await createProcessedImage(
        photo.image, "negative"
      );

      const scan = await createProcessedImage(
        photo.image, "scan"
      );

      photos.push({
        negative,
        scan,
        processed: negative
      });
    }

    await new Promise(resolve => setTimeout(resolve, 2500));

    renderFilm();

    developingScreen.hidden = true;
    resultsArea.hidden = false;
    developed = true;

  } catch (error) {
    console.error(error);
    developingScreen.hidden = true;
    developArea.hidden = false;
    shootStatus.textContent = "DEVELOPING FAILED. TRY AGAIN.";
  }

  developing = false;
}

// MODE SWITCHING

modeButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentMode = button.dataset.mode;

    modeButtons.forEach(item => {
      item.classList.toggle("active", item === button);
    });

    photos.forEach(photo => {
      photo.processed = photo[currentMode];
    });

    renderFilm();
  });
});

// LAYOUT SWITCHING

layoutButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentLayout = button.dataset.layout;

    layoutButtons.forEach(item => {
      item.classList.toggle("active", item === button);
    });

    renderFilm();
  });
});

// EXPORT

function loadDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function showSaveModal(imageUrl) {
  const existing = document.getElementById("saveImageModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "saveImageModal";
  modal.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 9999",
    "background: rgba(8, 6, 5, 0.94)",
    "display: flex",
    "flex-direction: column",
    "align-items: center",
    "justify-content: center",
    "padding: 20px",
    "gap: 16px"
  ].join(";");

  const hint = document.createElement("p");
  hint.textContent = "画像を長押しして「写真に保存」を選択してください";
  hint.style.cssText = [
    "color: #f0e8db",
    "font-size: 12px",
    "letter-spacing: 1px",
    "text-align: center"
  ].join(";");

  const previewImg = document.createElement("img");
  previewImg.src = imageUrl;
  previewImg.alt = "ROLL 12 Memory";
  previewImg.style.cssText = [
    "max-width: 100%",
    "max-height: 70vh",
    "border-radius: 4px",
    "box-shadow: 0 12px 35px rgba(0,0,0,0.8)",
    "-webkit-touch-callout: default"
  ].join(";");

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "CLOSE";
  closeBtn.style.cssText = [
    "padding: 12px 28px",
    "background: #252525",
    "color: #e99a42",
    "border: 1px solid #e99a42",
    "font-size: 11px",
    "letter-spacing: 2px",
    "border-radius: 4px",
    "cursor: pointer"
  ].join(";");

  closeBtn.addEventListener("click", () => {
    URL.revokeObjectURL(imageUrl);
    modal.remove();
  });

  modal.appendChild(hint);
  modal.appendChild(previewImg);
  modal.appendChild(closeBtn);
  document.body.appendChild(modal);
}

async function exportFilm() {
  if (!photos.length) return;

  exportButton.disabled = true;
  exportButton.textContent = "PREPARING...";

  try {
    const columns =
      currentLayout === "strip" ? 12 :
      currentLayout === "six" ? 6 : 4;

    const rows = Math.ceil(photos.length / columns);

    const frameWidth = currentLayout === "strip" ? 280 : 380;
    const frameHeight = Math.round(frameWidth * 0.75);
    const railHeight = 50;
    const seamHeight = 20;
    const sidePadding = 14;
    const frameGap = 12;

    const sheetWidth =
      sidePadding * 2 + columns * frameWidth + (columns - 1) * frameGap;

    const sheetHeight =
      railHeight * 2 +
      rows * frameHeight +
      (rows - 1) * seamHeight;

    const headerHeight = 136;
    const bottomPadding = 80;

    const width = sheetWidth;
    const height = headerHeight + sheetHeight + bottomPadding;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    const bgGrad = context.createRadialGradient(
      width / 2, height / 2, width * 0.1,
      width / 2, height / 2, width * 0.75
    );
    bgGrad.addColorStop(0, "#15110e");
    bgGrad.addColorStop(1, "#090706");
    context.fillStyle = bgGrad;
    context.fillRect(0, 0, width, height);

    const headerY = 74;
    context.save();
    context.font = 'italic 400 48px "Cormorant Garamond", Georgia, "Times New Roman", serif';
    context.fillStyle = "#f0e8db";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Memory", width / 2, headerY);

    const textWidth = context.measureText("Memory").width;
    const lineGap = 32;
    const lineLength = Math.min(440, (width - textWidth) / 2 - 120);

    if (lineLength > 40) {
      const leftStart = width / 2 - textWidth / 2 - lineGap - lineLength;
      const leftEnd = width / 2 - textWidth / 2 - lineGap;
      const leftGrad = context.createLinearGradient(leftStart, headerY, leftEnd, headerY);
      leftGrad.addColorStop(0, "rgba(238, 228, 212, 0)");
      leftGrad.addColorStop(1, "rgba(238, 228, 212, 0.6)");
      context.strokeStyle = leftGrad;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(leftStart, headerY);
      context.lineTo(leftEnd, headerY);
      context.stroke();

      const rightStart = width / 2 + textWidth / 2 + lineGap;
      const rightEnd = rightStart + lineLength;
      const rightGrad = context.createLinearGradient(rightStart, headerY, rightEnd, headerY);
      rightGrad.addColorStop(0, "rgba(238, 228, 212, 0.6)");
      rightGrad.addColorStop(1, "rgba(238, 228, 212, 0)");
      context.strokeStyle = rightGrad;
      context.beginPath();
      context.moveTo(rightStart, headerY);
      context.lineTo(rightEnd, headerY);
      context.stroke();
    }
    context.restore();

    const sheetY = headerHeight;
    context.fillStyle = "#1b140f";
    context.fillRect(0, sheetY, sheetWidth, sheetHeight);

    context.strokeStyle = "rgba(180, 120, 68, 0.25)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, sheetY);
    context.lineTo(sheetWidth, sheetY);
    context.moveTo(0, sheetY + sheetHeight);
    context.lineTo(sheetWidth, sheetY + sheetHeight);
    context.stroke();

    const holeStep = 48;
    const holeWidth = 20;
    const holeHeight = 32;
    const holeRadius = 4;
    const holeMarginY = (railHeight - holeHeight) / 2;

    for (let hx = 12; hx < sheetWidth - 12; hx += holeStep) {
      context.fillStyle = "#0b0908";
      context.strokeStyle = "rgba(140, 98, 64, 0.45)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.roundRect(hx, sheetY + holeMarginY, holeWidth, holeHeight, holeRadius);
      context.fill();
      context.stroke();

      context.beginPath();
      context.roundRect(
        hx,
        sheetY + sheetHeight - railHeight + holeMarginY,
        holeWidth,
        holeHeight,
        holeRadius
      );
      context.fill();
      context.stroke();
    }

    const loadedImages = await Promise.all(
      photos.map(photo => loadDataUrl(photo.processed))
    );

    for (let row = 0; row < rows; row++) {
      const rowY = sheetY + railHeight + row * (frameHeight + seamHeight);

      if (row > 0) {
        const seamY = rowY - seamHeight;
        context.fillStyle = "#130e0a";
        context.fillRect(0, seamY + 4, sheetWidth, seamHeight - 8);

        context.strokeStyle = "rgba(195, 135, 78, 0.22)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(0, seamY + seamHeight / 2);
        context.lineTo(sheetWidth, seamY + seamHeight / 2);
        context.stroke();
      }

      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        if (index >= loadedImages.length) break;

        const fx = sidePadding + col * (frameWidth + frameGap);
        const fy = rowY;

        context.save();
        context.beginPath();
        context.roundRect(fx, fy, frameWidth, frameHeight, 6);
        context.clip();
        context.drawImage(loadedImages[index], fx, fy, frameWidth, frameHeight);
        context.restore();
      }
    }

    context.save();
    context.globalCompositeOperation = "screen";

    const leakGrad = context.createLinearGradient(0, sheetY, sheetWidth, sheetY);
    leakGrad.addColorStop(0, "rgba(235, 102, 26, 0.72)");
    leakGrad.addColorStop(0.038, "rgba(218, 122, 44, 0.36)");
    leakGrad.addColorStop(0.09, "rgba(165, 95, 42, 0.12)");
    leakGrad.addColorStop(0.20, "rgba(0, 0, 0, 0)");
    leakGrad.addColorStop(0.88, "rgba(0, 0, 0, 0)");
    leakGrad.addColorStop(0.95, "rgba(180, 108, 45, 0.16)");
    leakGrad.addColorStop(1, "rgba(222, 114, 38, 0.45)");

    context.fillStyle = leakGrad;
    context.fillRect(0, sheetY, sheetWidth, sheetHeight);
    context.restore();

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, "image/png");
    });

    if (!blob) throw new Error("BLOB CREATION FAILED");

    const fileName = "ROLL12-Memory-" + currentMode + "-" + currentLayout + ".png";
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile && navigator.share && navigator.canShare) {
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "ROLL 12 - Memory"
          });
          return;
        } catch (shareError) {
          if (shareError.name === "AbortError") return;
        }
      }
    }

    const blobUrl = URL.createObjectURL(blob);

    if (isMobile) {
      showSaveModal(blobUrl);
    } else {
      const link = document.createElement("a");
      link.download = fileName;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }

  } catch (error) {
    console.error(error);
    alert("画像の書き出しに失敗しました。もう一度試してください。");
  } finally {
    exportButton.disabled = false;
    exportButton.textContent = "EXPORT IMAGE";
  }
}

// RESET ROLL BUTTON

function setupResetButton() {
  const exportArea = document.querySelector(".export-area");
  if (!exportArea || document.getElementById("resetRollButton")) return;

  const resetBtn = document.createElement("button");
  resetBtn.id = "resetRollButton";
  resetBtn.type = "button";
  resetBtn.textContent = "LOAD NEW FILM";
  resetBtn.style.cssText = [
    "display: block",
    "width: 100%",
    "max-width: 260px",
    "margin: 12px auto 0",
    "padding: 12px 20px",
    "background: transparent",
    "color: #888",
    "border: 1px solid #444",
    "font-size: 9px",
    "letter-spacing: 2px",
    "border-radius: 4px",
    "cursor: pointer"
  ].join(";");

  resetBtn.addEventListener("click", async () => {
    if (!confirm("新しいフィルムに入れ替えますか？（現在の12枚は消去されます）")) return;
    await clearAllPhotos();
    photos = [];
    photoTotal = 0;
    developed = false;
    resultsArea.hidden = true;
    developArea.hidden = true;
    updateDisplay();
    await startCamera();
  });

  exportArea.appendChild(resetBtn);
}

// EVENTS

shutterButton.addEventListener("click", takePhoto);
if (switchCameraButton) {
  switchCameraButton.addEventListener("click", switchCamera);
}
developButton.addEventListener("click", developFilm);
exportButton.addEventListener("click", exportFilm);

// INITIALIZE

async function initialize() {
  try {
    setupResetButton();
    db = await openDatabase();

    const savedPhotos = await getAllPhotos();
    photoTotal = savedPhotos.length;

    updateDisplay();

    if (photoTotal >= MAX_PHOTOS) {
      shootStatus.textContent = "12 FRAMES EXPOSED";
    } else {
      await startCamera();
    }

  } catch (error) {
    console.error(error);
    cameraMessage.textContent = "STORAGE ERROR";
    cameraSubMessage.textContent = "PLEASE RELOAD";
    shootStatus.textContent = "COULD NOT OPEN PHOTO STORAGE";
  }
}

initialize();
