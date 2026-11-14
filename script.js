const video = document.getElementById("cameraPreview");
const shutterButton = document.getElementById("shutterButton");
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

let db;
let photos = [];
let photoTotal = 0;
let cameraStream = null;
let currentMode = "negative";
let currentLayout = "six"; // 初期表示を 6×2 に設定
let developing = false;
let developed = false;

// DATABASE

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ROLL12Database", 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("photos", {
        keyPath: "id",
        autoIncrement: true
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllPhotos() {
  return new Promise((resolve, reject) => {
    const request = db.transaction("photos", "readonly")
      .objectStore("photos").getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function savePhoto(blob) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("photos", "readwrite");

    transaction.objectStore("photos").add({
      image: blob,
      createdAt: new Date().toISOString()
    });

    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

// CAMERA

async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("CAMERA NOT SUPPORTED");
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    video.srcObject = cameraStream;
    await video.play();

    video.style.display = "block";
    cameraMessage.textContent = "READY";
    cameraSubMessage.textContent = "FRAME " +
      String(photoTotal + 1).padStart(2, "0");

    shutterButton.disabled = false;
    shootStatus.textContent = "CAMERA READY";

  } catch (error) {
    console.error(error);
    cameraMessage.textContent = "CAMERA ERROR";
    cameraSubMessage.textContent = "CHECK CAMERA PERMISSION";
    shootStatus.textContent = "ALLOW CAMERA ACCESS";
  }
}

async function takePhoto() {
  if (!cameraStream || photoTotal >= MAX_PHOTOS) return;
  if (!video.videoWidth || !video.videoHeight) return;

  shutterButton.disabled = true;
  shootStatus.textContent = "CAPTURING...";

  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    canvas.getContext("2d").drawImage(
      video, 0, 0, canvas.width, canvas.height
    );

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, "image/jpeg", 0.95);
    });

    if (!blob) throw new Error("PHOTO CAPTURE FAILED");

    await savePhoto(blob);

    photoTotal++;
    updateDisplay();

    if (photoTotal < MAX_PHOTOS) {
      shutterButton.disabled = false;
      shootStatus.textContent = "PHOTO SAVED";
    }

  } catch (error) {
    console.error(error);
    shootStatus.textContent = "SAVE FAILED. TRY AGAIN.";
    shutterButton.disabled = false;
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
    developArea.hidden = false;

    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
  } else {
    cameraSubMessage.textContent =
      "FRAME " + String(photoTotal + 1).padStart(2, "0");
  }
}

// IMAGE PROCESSING

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = reject;
    image.src = url;
  });
}

async function createProcessedImage(blob, mode) {
  const image = await loadImage(blob);

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

// FILM FRAME (Memoryヘッダー ＋ 上下のみ送り穴・中央継ぎ目のフィルムシート)

function renderFilm() {
  negativeStrip.innerHTML = "";
  negativeStrip.className =
    "negative-strip layout-" + currentLayout +
    " mode-" + currentMode;

  // 上部の「Memory」装飾ヘッダー
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

  // フィルムシート本体
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
    // 2行目以降は間にフィルムの水平継ぎ目を入れる
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

// EXPORT (Memoryタイトル ＋ 光漏れ付き6×2フィルムシート書き出し)

async function exportFilm() {
  if (!photos.length) return;

  exportButton.disabled = true;
  exportButton.textContent = "PREPARING...";

  try {
    const columns =
      currentLayout === "strip" ? 12 :
      currentLayout === "six" ? 6 : 4;

    const rows = Math.ceil(photos.length / columns);

    const frameWidth = currentLayout === "strip" ? 340 : 420;
    const frameHeight = Math.round(frameWidth * 0.75);
    const railHeight = 56;
    const seamHeight = 22;
    const sidePadding = 16;
    const frameGap = 14;

    const sheetWidth =
      sidePadding * 2 + columns * frameWidth + (columns - 1) * frameGap;

    const sheetHeight =
      railHeight * 2 +
      rows * frameHeight +
      (rows - 1) * seamHeight;

    const headerHeight = 150;
    const bottomPadding = 90;

    const width = sheetWidth;
    const height = headerHeight + sheetHeight + bottomPadding;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    // 1. 漆黒のヴィンテージ背景
    const bgGrad = context.createRadialGradient(
      width / 2, height / 2, width * 0.1,
      width / 2, height / 2, width * 0.75
    );
    bgGrad.addColorStop(0, "#15110e");
    bgGrad.addColorStop(1, "#090706");
    context.fillStyle = bgGrad;
    context.fillRect(0, 0, width, height);

    // 2. 上部「Memory」タイトルと左右の細線
    const headerY = 82;
    context.save();
    context.font = 'italic 400 54px "Cormorant Garamond", Georgia, "Times New Roman", serif';
    context.fillStyle = "#f0e8db";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Memory", width / 2, headerY);

    const textWidth = context.measureText("Memory").width;
    const lineGap = 36;
    const lineLength = Math.min(480, (width - textWidth) / 2 - 140);

    if (lineLength > 40) {
      // 左線
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

      // 右線
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

    // 3. 暗褐色のフィルムシートベース
    const sheetY = headerHeight;
    context.fillStyle = "#1b140f";
    context.fillRect(0, sheetY, sheetWidth, sheetHeight);

    // シート上下の微細な縁取り
    context.strokeStyle = "rgba(180, 120, 68, 0.25)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, sheetY);
    context.lineTo(sheetWidth, sheetY);
    context.moveTo(0, sheetY + sheetHeight);
    context.lineTo(sheetWidth, sheetY + sheetHeight);
    context.stroke();

    // 4. 上下端の縦長パーフォレーション（送り穴）
    const holeStep = 54;
    const holeWidth = 23;
    const holeHeight = 36;
    const holeRadius = 5;
    const holeMarginY = (railHeight - holeHeight) / 2;

    for (let hx = 14; hx < sheetWidth - 14; hx += holeStep) {
      // 上穴
      context.fillStyle = "#0b0908";
      context.strokeStyle = "rgba(140, 98, 64, 0.45)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.roundRect(hx, sheetY + holeMarginY, holeWidth, holeHeight, holeRadius);
      context.fill();
      context.stroke();

      // 下穴
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

    // 5. 各行の写真と中央の水平継ぎ目
    for (let row = 0; row < rows; row++) {
      const rowY = sheetY + railHeight + row * (frameHeight + seamHeight);

      if (row > 0) {
        const seamY = rowY - seamHeight;
        context.fillStyle = "#130e0a";
        context.fillRect(0, seamY + 5, sheetWidth, seamHeight - 10);

        context.strokeStyle = "rgba(195, 135, 78, 0.22)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(0, seamY + seamHeight / 2);
        context.lineTo(sheetWidth, seamY + seamHeight / 2);
        context.stroke();
      }

      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        if (index >= photos.length) break;

        const fx = sidePadding + col * (frameWidth + frameGap);
        const fy = rowY;

        const image = await loadImage(
          await fetch(photos[index].processed).then(r => r.blob())
        );

        context.save();
        context.beginPath();
        context.roundRect(fx, fy, frameWidth, frameHeight, 7);
        context.clip();
        context.drawImage(image, fx, fy, frameWidth, frameHeight);
        context.restore();
      }
    }

    // 6. 左端・右端の光漏れ（ライトリーク）オーバーレイ
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

    const link = document.createElement("a");
    link.download = "ROLL12-Memory-" + currentMode + "-" + currentLayout + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();

  } catch (error) {
    console.error(error);
    alert("画像の書き出しに失敗しました。もう一度試してください。");
  }

  exportButton.disabled = false;
  exportButton.textContent = "EXPORT IMAGE";
}

// EVENTS

shutterButton.addEventListener("click", takePhoto);
developButton.addEventListener("click", developFilm);
exportButton.addEventListener("click", exportFilm);

// INITIALIZE

async function initialize() {
  try {
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