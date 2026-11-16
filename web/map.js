const HOME = [-62.6, 44.8];
const LON_SCALE = .71;
const LABELS = [
  ["NOVA SCOTIA", -63.3, 45.14], ["NEW BRUNSWICK", -66.45, 46.25],
  ["PRINCE EDWARD ISLAND", -63.12, 46.49], ["CAPE BRETON", -60.88, 46.08],
  ["HALIFAX", -63.50, 44.70], ["SABLE ISLAND", -59.90, 43.79],
  ["BAY OF FUNDY", -66.12, 44.88], ["ATLANTIC OCEAN", -62.56, 42.80]
];

export class WreckMap {
  constructor(canvas, onMove, onPick) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onMove = onMove;
    this.onPick = onPick;
    this.rows = [];
    this.points = [];
    this.centre = [...HOME];
    this.zoom = 1;
    this.scale = 1;
    this.pressed = null;
    this.frame = 0;
    this.land = null;
    this.resize = this.resize.bind(this);
    if (!this.ctx) return;
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.resize();

    canvas.addEventListener("pointerdown", event => {
      if (!event.isPrimary || event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      this.pressed = { x: event.offsetX, y: event.offsetY, startX: event.offsetX, startY: event.offsetY };
    });
    canvas.addEventListener("pointermove", event => {
      if (!event.isPrimary) return;
      const p = this.pressed;
      if (!p) {
        const point = this.hit(event.offsetX, event.offsetY);
        canvas.title = !point ? "Drag the map to pan" : point.rows.length > 1 ? `${point.rows.length} nearby records` : point.rows[0].name;
        return;
      }
      if (!p.dragged && Math.hypot(event.offsetX - p.startX, event.offsetY - p.startY) < 4) return;
      p.dragged = true;
      this.pan(event.offsetX - p.x, event.offsetY - p.y, false);
      p.x = event.offsetX;
      p.y = event.offsetY;
    });
    canvas.addEventListener("pointerup", event => {
      const p = this.pressed;
      this.pressed = null;
      if (!event.isPrimary || !p) return;
      if (p.dragged) {
        this.onMove();
        return;
      }
      const point = this.hit(event.offsetX, event.offsetY);
      if (point) this.onPick(point.rows);
    });
    canvas.addEventListener("pointercancel", () => {
      if (this.pressed?.dragged) this.onMove();
      this.pressed = null;
    });
    canvas.addEventListener("keydown", event => {
      const deltas = { ArrowLeft: [36, 0], ArrowRight: [-36, 0], ArrowUp: [0, 36], ArrowDown: [0, -36] };
      if (event.key in deltas) {
        event.preventDefault();
        this.pan(...deltas[event.key]);
      } else if (["+", "=", "-"].includes(event.key)) {
        event.preventDefault();
        this.magnify(event.key === "-" ? 1 / 1.5 : 1.5);
      }
    });
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.updateScale();
    this.drawSoon();
    this.onMove();
  }

  updateScale() {
    this.scale = Math.min(this.width / (11 * LON_SCALE), this.height / 5.7) * this.zoom;
  }

  landShape(polygons) {
    if (!this.ctx || !Array.isArray(polygons)) return;
    this.land = new Path2D();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        ring.forEach(([lon, lat], i) => { if (i === 0) this.land.moveTo(lon, lat); else this.land.lineTo(lon, lat); });
        this.land.closePath();
      }
    }
    this.drawSoon();
  }

  setRows(rows) {
    this.rows = rows;
    this.drawSoon();
  }

  pan(dx, dy, notify = true) {
    if (!this.ctx) return;
    this.centre[0] = Math.max(-80, Math.min(-45, this.centre[0] - dx / (this.scale * LON_SCALE)));
    this.centre[1] = Math.max(38, Math.min(56, this.centre[1] + dy / this.scale));
    this.drawSoon();
    if (notify) this.onMove();
  }

  magnify(factor) {
    if (!this.ctx) return;
    this.zoom = Math.max(.45, Math.min(22, this.zoom * factor));
    this.updateScale();
    this.drawSoon();
    this.onMove();
  }

  reset() {
    if (!this.ctx) return;
    this.centre = [...HOME];
    this.zoom = 1;
    this.updateScale();
    this.drawSoon();
    this.onMove();
  }

  focus(point) {
    if (!this.ctx || !point) return;
    this.centre = [...point];
    this.zoom = 3;
    this.updateScale();
    this.drawSoon();
    this.onMove();
  }

  project([longitude, latitude]) {
    return [
      this.width / 2 + (longitude - this.centre[0]) * this.scale * LON_SCALE,
      this.height / 2 - (latitude - this.centre[1]) * this.scale
    ];
  }

  visible(point) {
    if (!point || !this.width) return false;
    const [x, y] = this.project(point);
    return x >= 0 && x <= this.width && y >= 0 && y <= this.height;
  }

  hit(x, y) {
    return this.points.find(point => Math.hypot(point.x - x, point.y - y) <= point.r + 5);
  }

  drawSoon() {
    if (this.ctx && !this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  draw() {
    const ctx = this.ctx;
    const { width, height, dpr, scale } = this;
    if (!width || !height) return;
    const [originX, originY] = this.project([0, 0]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#17342f";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.transform(scale * LON_SCALE, 0, 0, -scale, originX, originY);
    if (this.land) {
      ctx.fillStyle = "#3b5748";
      ctx.fill(this.land, "evenodd");
      ctx.strokeStyle = "#79927a";
      ctx.lineWidth = 1 / scale;
      ctx.stroke(this.land);
    }
    ctx.beginPath();
    const step = this.zoom < .85 ? 2 : this.zoom > 4 ? .25 : 1;
    for (let i = -82; i <= -42; i += step) { ctx.moveTo(i, 36); ctx.lineTo(i, 58); }
    for (let i = 36; i <= 58; i += step) { ctx.moveTo(-83, i); ctx.lineTo(-42, i); }
    ctx.strokeStyle = "#b7c6a339";
    ctx.lineWidth = .7 / scale;
    ctx.stroke();
    ctx.restore();

    ctx.font = '600 10px "IBM Plex Mono",monospace';
    ctx.fillStyle = "#d4dfcd";
    ctx.textAlign = "center";
    for (const [label, lon, lat] of LABELS) {
      const [x, y] = this.project([lon, lat]);
      ctx.fillText(label, x, y);
    }
    const cells = new Map();
    for (const row of this.rows) {
      if (!row.point) continue;
      const [x, y] = this.project(row.point);
      if (x < 0 || y < 0 || x > width || y > height) continue;
      const key = `${Math.floor(x / 27)}:${Math.floor(y / 27)}`;
      if (!cells.has(key)) cells.set(key, { x: 0, y: 0, rows: [] });
      const cell = cells.get(key);
      cell.x += x;
      cell.y += y;
      cell.rows.push(row);
    }

    this.points = [...cells.values()].map(cell => {
      const count = cell.rows.length;
      return { x: cell.x / count, y: cell.y / count, r: count > 1 ? Math.min(17, 6 + Math.log2(count)) : 3.4, rows: cell.rows };
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const { x, y, r, rows } of this.points) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = rows.length > 1 ? "#c4ed89" : "#e4edcf";
      ctx.fill();
      ctx.strokeStyle = "#253f31";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (rows.length > 1) {
        ctx.fillStyle = "#17201c";
        ctx.font = '700 10px "IBM Plex Mono",monospace';
        ctx.fillText(rows.length, x, y + .3);
      }
    }
  }
}
