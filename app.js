/* ============================================================
   app.js – Game of QR
   Scan / upload a QR code → extract its binary module grid
   → seed Conway's Game of Life and animate it.
   ============================================================ */
'use strict';

// ── Constants ──────────────────────────────────────────────────
const SCAN_INTERVAL_MS    = 80;          // ~12 fps scan rate
const DEFAULT_CELL_COLOR  = '#00ff88';
const DEAD_COLOR          = '#0d1117';
const CANVAS_PX           = 600;         // internal game-canvas resolution

// ── QR module-count detection ──────────────────────────────────
/**
 * Estimate the number of QR modules along one side by sampling
 * the top edge of the detected QR region.  The first unbroken
 * dark run corresponds to the 7-module-wide finder-pattern border,
 * giving us the module width in pixels.
 *
 * Falls back to 41 (QR version 6) when the heuristic fails.
 *
 * @param {ImageData} imageData  Full-image pixel data
 * @param {object}    location   jsQR location (corner coords)
 * @returns {number}  Nearest valid QR module count (21, 25, 29 …)
 */
function detectModuleCount(imageData, location) {
  const { topLeftCorner: tl, topRightCorner: tr } = location;
  const NUM_SAMPLES = 600;
  const signal = new Uint8Array(NUM_SAMPLES);

  const dx = tr.x - tl.x;
  const dy = tr.y - tl.y;
  const edgeLen = Math.sqrt(dx * dx + dy * dy);

  // Offset 1.5 px inward (perpendicular) so we're inside the first row
  const perpX = (-dy / edgeLen) * 1.5;
  const perpY = ( dx / edgeLen) * 1.5;

  for (let i = 0; i < NUM_SAMPLES; i++) {
    const t = i / (NUM_SAMPLES - 1);
    const x = Math.round(tl.x + t * dx + perpX);
    const y = Math.round(tl.y + t * dy + perpY);

    if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) {
      signal[i] = 1;   // treat out-of-bounds as light
      continue;
    }

    const idx = (y * imageData.width + x) * 4;
    const brightness = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3;
    signal[i] = brightness < 128 ? 0 : 1;   // 0 = dark, 1 = light
  }

  // Find first dark run (= the top border of the finder pattern = 7 modules)
  let runLen = 0;
  let started = false;

  for (let i = 0; i < NUM_SAMPLES; i++) {
    if (signal[i] === 0) {
      started = true;
      runLen++;
    } else if (started) {
      break;
    }
  }

  if (runLen < 4) return 41;   // detection failed – use sensible default

  const moduleWidthSamples = runLen / 7;
  const estimated = Math.round(NUM_SAMPLES / moduleWidthSamples);

  // Valid QR module counts: 21 + 4*version  (version 1–40)
  const version = Math.round((estimated - 21) / 4);
  const clamped = Math.max(0, Math.min(39, version));
  return 21 + 4 * clamped;
}

// ── QR binary-matrix extraction ─────────────────────────────────
/**
 * Build an N×N binary matrix from the QR code region in imageData.
 * Uses bilinear (perspective) interpolation over the four detected
 * corners so the result is correct even for rotated / skewed images.
 *
 * Adaptive threshold: average brightness of sampled pixels is used
 * so the result works for both light-on-dark and dark-on-light prints.
 *
 * @param {ImageData} imageData
 * @param {object}    location     jsQR location corners
 * @param {number}    moduleCount  Grid dimension (e.g. 41)
 * @returns {number[][]}  2-D array of 0s and 1s  (1 = dark/alive)
 */
function extractQRMatrix(imageData, location, moduleCount) {
  const { topLeftCorner: tl, topRightCorner: tr,
          bottomLeftCorner: bl, bottomRightCorner: br } = location;

  const brightness = new Float32Array(moduleCount * moduleCount);

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      const s = (col + 0.5) / moduleCount;   // horizontal  [0, 1]
      const t = (row + 0.5) / moduleCount;   // vertical    [0, 1]

      // Bilinear interpolation across the four corner points
      const x = (1 - t) * (1 - s) * tl.x + (1 - t) * s * tr.x
              +      t  * (1 - s) * bl.x +      t  * s * br.x;
      const y = (1 - t) * (1 - s) * tl.y + (1 - t) * s * tr.y
              +      t  * (1 - s) * bl.y +      t  * s * br.y;

      const px = Math.round(x);
      const py = Math.round(y);

      if (px < 0 || px >= imageData.width || py < 0 || py >= imageData.height) {
        brightness[row * moduleCount + col] = 255;
        continue;
      }

      const i = (py * imageData.width + px) * 4;
      brightness[row * moduleCount + col] =
        (imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3;
    }
  }

  // Adaptive threshold = mean brightness of the sampled pixels
  const mean = brightness.reduce((a, b) => a + b, 0) / brightness.length;

  const matrix = [];
  for (let row = 0; row < moduleCount; row++) {
    const rowArr = new Array(moduleCount);
    for (let col = 0; col < moduleCount; col++) {
      rowArr[col] = brightness[row * moduleCount + col] < mean ? 1 : 0;
    }
    matrix.push(rowArr);
  }
  return matrix;
}

// ── Conway's Game of Life ────────────────────────────────────────
class GameOfLife {
  /**
   * @param {number[][]} initialGrid  2-D array of 0s / 1s
   */
  constructor(initialGrid) {
    this.rows = initialGrid.length;
    this.cols = initialGrid[0].length;
    // Store initial state for reset
    this._initial = initialGrid.map(r => new Uint8Array(r));
    this.grid     = initialGrid.map(r => new Uint8Array(r));
    this.generation = 0;
  }

  /** Advance by one generation (toroidal / wrap-around edges). */
  step() {
    const { rows, cols, grid } = this;
    const next = Array.from({ length: rows }, () => new Uint8Array(cols));

    for (let r = 0; r < rows; r++) {
      const rp = (r - 1 + rows) % rows;
      const rn = (r + 1) % rows;

      for (let c = 0; c < cols; c++) {
        const cp = (c - 1 + cols) % cols;
        const cn = (c + 1) % cols;

        const neighbours =
          grid[rp][cp] + grid[rp][c] + grid[rp][cn] +
          grid[r ][cp] +               grid[r ][cn] +
          grid[rn][cp] + grid[rn][c] + grid[rn][cn];

        const alive = grid[r][c];
        next[r][c] = alive
          ? (neighbours === 2 || neighbours === 3 ? 1 : 0)
          : (neighbours === 3 ? 1 : 0);
      }
    }

    this.grid = next;
    this.generation++;
  }

  /** Count live cells. */
  countAlive() {
    let n = 0;
    for (const row of this.grid) for (const c of row) n += c;
    return n;
  }

  /** Restore to the initial state. */
  reset() {
    this.grid = this._initial.map(r => new Uint8Array(r));
    this.generation = 0;
  }
}

// ── Canvas renderer ──────────────────────────────────────────────
class Renderer {
  constructor(canvas) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.cellColor = DEFAULT_CELL_COLOR;
    this.deadColor = DEAD_COLOR;

    // Fixed internal resolution – CSS scales it
    canvas.width  = CANVAS_PX;
    canvas.height = CANVAS_PX;
  }

  render(game) {
    const { canvas, ctx, cellColor, deadColor } = this;
    const cw = CANVAS_PX / game.cols;
    const ch = CANVAS_PX / game.rows;
    const gap = cw >= 3 ? 1 : 0;   // 1 px grid gap only for larger cells

    ctx.fillStyle = deadColor;
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    ctx.fillStyle = cellColor;
    for (let r = 0; r < game.rows; r++) {
      const y = Math.floor(r * ch);
      const h = Math.max(1, Math.ceil(ch) - gap);
      for (let c = 0; c < game.cols; c++) {
        if (game.grid[r][c]) {
          ctx.fillRect(Math.floor(c * cw), y, Math.max(1, Math.ceil(cw) - gap), h);
        }
      }
    }
  }
}

// ── Main App ─────────────────────────────────────────────────────
class App {
  constructor() {
    this.game         = null;   // GameOfLife instance
    this.renderer     = null;   // Renderer instance
    this.matrix       = null;   // extracted binary matrix
    this.rafId        = null;   // requestAnimationFrame handle
    this.lastTick     = 0;      // timestamp of last GOL step
    this.fps          = 10;
    this.playing      = false;
    this.cellColor    = DEFAULT_CELL_COLOR;

    this.videoStream  = null;
    this.scanTimer    = null;
    this.cameraActive = false;

    this._initRenderer();
    this._bindUI();
  }

  // ─── Renderer setup ──────────────────────────────────────────
  _initRenderer() {
    this.renderer = new Renderer(document.getElementById('game-canvas'));
  }

  // ─── UI binding ──────────────────────────────────────────────
  _bindUI() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab))
    );

    // Camera
    document.getElementById('camera-toggle')
      .addEventListener('click', () =>
        this.cameraActive ? this._stopCamera() : this._startCamera()
      );

    // File upload
    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', e => {
      if (e.target.files[0]) this._handleFile(e.target.files[0]);
    });

    // Drag-and-drop
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) this._handleFile(file);
    });

    // Preview buttons
    document.getElementById('start-game-btn').addEventListener('click',  () => this._startGame());
    document.getElementById('scan-again-btn').addEventListener('click',  () => this._scanAgain());

    // Game controls
    document.getElementById('play-pause-btn').addEventListener('click',  () => this._togglePlay());
    document.getElementById('step-btn')       .addEventListener('click',  () => this._stepOnce());
    document.getElementById('reset-btn')      .addEventListener('click',  () => this._resetGame());
    document.getElementById('new-qr-btn')     .addEventListener('click',  () => this._scanAgain());

    // Speed slider
    const speedSlider = document.getElementById('speed-slider');
    speedSlider.addEventListener('input', () => {
      this.fps = parseInt(speedSlider.value, 10);
      document.getElementById('fps-display').textContent = this.fps;
    });

    // Colour swatches
    document.querySelectorAll('.swatch').forEach(sw =>
      sw.addEventListener('click', () => {
        document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        this.cellColor = sw.dataset.color;
        if (this.renderer) this.renderer.cellColor = this.cellColor;
        if (this.game) this.renderer.render(this.game);
      })
    );

    // Re-render on window resize
    window.addEventListener('resize', () => {
      if (this.game) this.renderer.render(this.game);
    });
  }

  // ─── Tab switching ────────────────────────────────────────────
  _switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active);
    });
    document.querySelectorAll('.tab-panel').forEach(p =>
      p.classList.toggle('active', p.id === `${tab}-panel`)
    );
    if (tab !== 'camera') this._stopCamera();
  }

  // ─── Camera ──────────────────────────────────────────────────
  async _startCamera() {
    const statusEl = document.getElementById('camera-status');
    const toggleBtn = document.getElementById('camera-toggle');

    statusEl.textContent = 'Requesting camera access…';

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      const video = document.getElementById('video');
      video.srcObject = this.videoStream;
      await video.play();

      this.cameraActive = true;
      toggleBtn.textContent = '⏹ Stop Camera';
      statusEl.textContent = 'Scanning for QR code…';

      document.getElementById('scan-line').classList.add('active');
      this._startScanning();

    } catch (err) {
      console.error('Camera error:', err);
      statusEl.textContent =
        `Camera unavailable: ${err.message}. Please use the Upload tab.`;
    }
  }

  _stopCamera() {
    if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; }

    if (this.videoStream) {
      this.videoStream.getTracks().forEach(t => t.stop());
      this.videoStream = null;
    }

    const video = document.getElementById('video');
    if (video) video.srcObject = null;

    this.cameraActive = false;
    document.getElementById('scan-line').classList.remove('active');

    const btn = document.getElementById('camera-toggle');
    if (btn) btn.textContent = '📷 Start Camera';

    const status = document.getElementById('camera-status');
    if (status) status.textContent = 'Camera stopped.';
  }

  _startScanning() {
    const video     = document.getElementById('video');
    const canvas    = document.getElementById('scan-canvas');
    const ctx       = canvas.getContext('2d');
    const statusEl  = document.getElementById('camera-status');

    const tick = () => {
      if (!this.cameraActive) return;

      if (video.readyState >= video.HAVE_ENOUGH_DATA) {
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(imageData.data, imageData.width, imageData.height,
                            { inversionAttempts: 'dontInvert' });

        if (result) {
          this._stopCamera();
          this._handleQRResult(result, imageData);
          return;
        }
        statusEl.textContent = 'Scanning for QR code…';
      }

      this.scanTimer = setTimeout(tick, SCAN_INTERVAL_MS);
    };

    this.scanTimer = setTimeout(tick, 200);
  }

  // ─── File upload ──────────────────────────────────────────────
  _handleFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.getElementById('upload-canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);

        const imageData = canvas.getContext('2d')
                                .getImageData(0, 0, canvas.width, canvas.height);

        const result = jsQR(imageData.data, imageData.width, imageData.height,
                            { inversionAttempts: 'attemptBoth' });

        if (result) {
          this._handleQRResult(result, imageData);
        } else {
          alert('No QR code detected in this image.\nPlease try a clearer image.');
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ─── QR processing ────────────────────────────────────────────
  _handleQRResult(qrResult, imageData) {
    const moduleCount = detectModuleCount(imageData, qrResult.location);
    const matrix      = extractQRMatrix(imageData, qrResult.location, moduleCount);
    this.matrix = matrix;

    const total  = moduleCount * moduleCount;
    const alive  = matrix.flat().reduce((a, b) => a + b, 0);
    const pct    = Math.round((alive / total) * 100);

    // Truncate long content
    const raw     = qrResult.data;
    const content = raw.length > 80 ? raw.slice(0, 77) + '…' : raw;

    document.getElementById('qr-content-display').textContent = content;
    document.getElementById('grid-size-display') .textContent = `${moduleCount} × ${moduleCount}`;
    document.getElementById('live-cells-display').textContent = `${alive} (${pct}%)`;

    this._renderPreview(matrix, moduleCount);

    document.getElementById('input-section')  .hidden = true;
    document.getElementById('preview-section').hidden = false;
    document.getElementById('game-section')   .hidden = true;
  }

  _renderPreview(matrix, moduleCount) {
    const canvas   = document.getElementById('qr-preview');
    const cellSize = Math.max(2, Math.min(10, Math.floor(240 / moduleCount)));
    const size     = cellSize * moduleCount;

    canvas.width  = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        ctx.fillStyle = matrix[r][c] ? '#000000' : '#ffffff';
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
      }
    }
  }

  // ─── Flow control ─────────────────────────────────────────────
  _scanAgain() {
    this._stopLoop();
    this._stopCamera();
    this.matrix = null;
    this.game   = null;

    document.getElementById('input-section')  .hidden = false;
    document.getElementById('preview-section').hidden = true;
    document.getElementById('game-section')   .hidden = true;

    // Reset file input so the same file can be re-selected
    document.getElementById('file-input').value = '';
    document.getElementById('camera-status').textContent =
      'Press "Start Camera" to begin scanning.';
    document.getElementById('camera-toggle').textContent = '📷 Start Camera';
  }

  // ─── Game of Life control ─────────────────────────────────────
  _startGame() {
    if (!this.matrix) return;

    this.game = new GameOfLife(this.matrix);
    this.renderer.cellColor = this.cellColor;

    document.getElementById('preview-section').hidden = true;
    document.getElementById('game-section')   .hidden = false;

    this.renderer.render(this.game);
    this._updateStats();

    this.playing = true;
    document.getElementById('play-pause-btn').textContent = '⏸ Pause';
    this._loop();
  }

  _loop() {
    this.rafId = requestAnimationFrame(ts => {
      if (!this.playing) return;

      const interval = 1000 / this.fps;
      if (ts - this.lastTick >= interval) {
        this.lastTick = ts;
        this.game.step();
        this.renderer.render(this.game);
        this._updateStats();

        // Auto-pause if population hits zero
        if (this.game.countAlive() === 0) {
          this._togglePlay();
          document.getElementById('camera-status').textContent =
            'All cells extinct. Press Reset to restart.';
        }
      }
      if (this.playing) this._loop();
    });
  }

  _stopLoop() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.playing = false;
  }

  _togglePlay() {
    if (this.playing) {
      this._stopLoop();
      document.getElementById('play-pause-btn').textContent = '▶ Play';
    } else {
      this.playing = true;
      document.getElementById('play-pause-btn').textContent = '⏸ Pause';
      this._loop();
    }
  }

  _stepOnce() {
    if (!this.game) return;
    // Pause first if running
    if (this.playing) {
      this._stopLoop();
      document.getElementById('play-pause-btn').textContent = '▶ Play';
    }
    this.game.step();
    this.renderer.render(this.game);
    this._updateStats();
  }

  _resetGame() {
    if (!this.game) return;
    const wasPlaying = this.playing;
    this._stopLoop();
    this.game.reset();
    this.renderer.render(this.game);
    this._updateStats();
    if (wasPlaying) {
      this.playing = true;
      document.getElementById('play-pause-btn').textContent = '⏸ Pause';
      this._loop();
    }
  }

  // ─── Stats update ─────────────────────────────────────────────
  _updateStats() {
    if (!this.game) return;
    const alive = this.game.countAlive();
    const total = this.game.rows * this.game.cols;
    const pct   = total > 0 ? (alive / total) * 100 : 0;

    document.getElementById('gen-display')  .textContent = this.game.generation;
    document.getElementById('alive-display').textContent = alive;

    const fill = document.getElementById('pop-fill');
    fill.style.width = `${pct.toFixed(1)}%`;
    fill.setAttribute('aria-valuenow', Math.round(pct));
  }
}

// ── Bootstrap ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window._app = new App();
});
