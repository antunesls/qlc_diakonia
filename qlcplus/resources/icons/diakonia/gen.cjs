// Builds the Diakonia logo assets from the PDF alpha masks
const fs = require("fs"), path = require("path");
const { png, W, H } = require("./extract.cjs");
const [maskDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const full = { w: W, h: H, a: fs.readFileSync(path.join(maskDir, "mask31.raw")) };
const symbolOnly = { w: W, h: H, a: fs.readFileSync(path.join(maskDir, "mask21.raw")) };

function bbox(m, threshold = 8) {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++)
    if (m.a[y * m.w + x] > threshold) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function crop(m, r) {
  const a = Buffer.alloc(r.w * r.h);
  for (let y = 0; y < r.h; y++) m.a.copy(a, y * r.w, (r.y + y) * m.w + r.x, (r.y + y) * m.w + r.x + r.w);
  return { w: r.w, h: r.h, a };
}
// Area-average downscale (good quality for big reductions)
function resize(m, nw, nh) {
  const a = Buffer.alloc(nw * nh);
  const sx = m.w / nw, sy = m.h / nh;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const fx0 = x * sx, fx1 = fx0 + sx, fy0 = y * sy, fy1 = fy0 + sy;
    let sum = 0, area = 0;
    for (let yy = Math.floor(fy0); yy < Math.min(m.h, Math.ceil(fy1)); yy++) {
      const wy = Math.min(fy1, yy + 1) - Math.max(fy0, yy);
      for (let xx = Math.floor(fx0); xx < Math.min(m.w, Math.ceil(fx1)); xx++) {
        const wx = Math.min(fx1, xx + 1) - Math.max(fx0, xx);
        sum += m.a[yy * m.w + xx] * wx * wy; area += wx * wy;
      }
    }
    a[y * nw + x] = Math.round(sum / area);
  }
  return { w: nw, h: nh, a };
}
// Separable max filter: thickens thin strokes so they survive small sizes
function dilate(m, r) {
  r = Math.round(r);
  if (r < 1) return m;
  const tmp = Buffer.alloc(m.w * m.h), a = Buffer.alloc(m.w * m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    let v = 0; for (let k = Math.max(0, x - r); k <= Math.min(m.w - 1, x + r); k++) v = Math.max(v, m.a[y * m.w + k]);
    tmp[y * m.w + x] = v;
  }
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    let v = 0; for (let k = Math.max(0, y - r); k <= Math.min(m.h - 1, y + r); k++) v = Math.max(v, tmp[k * m.w + x]);
    a[y * m.w + x] = v;
  }
  return { w: m.w, h: m.h, a };
}
// Thicken to about $px output pixels of extra stroke when shrinking to $size
function bold(m, size, px) { return dilate(m, Math.min(18, (m.w / size) * px)); }
function fit(m, maxW, maxH) {
  const k = Math.min(maxW / m.w, maxH / m.h);
  return resize(m, Math.max(1, Math.round(m.w * k)), Math.max(1, Math.round(m.h * k)));
}

/* RGBA canvas helpers */
function canvas(w, h) { return { w, h, px: Buffer.alloc(w * h * 4) }; }
function over(c, x, y, r, g, b, a) { // alpha compositing, a in 0..1
  const i = (y * c.w + x) * 4, da = c.px[i + 3] / 255, oa = a + da * (1 - a);
  if (oa <= 0) return;
  c.px[i] = Math.round((r * a + c.px[i] * da * (1 - a)) / oa);
  c.px[i + 1] = Math.round((g * a + c.px[i + 1] * da * (1 - a)) / oa);
  c.px[i + 2] = Math.round((b * a + c.px[i + 2] * da * (1 - a)) / oa);
  c.px[i + 3] = Math.round(oa * 255);
}
function paintMask(c, m, ox, oy, [r, g, b]) {
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const v = m.a[y * m.w + x];
    if (v) over(c, ox + x, oy + y, r, g, b, v / 255);
  }
}
// Anti-aliased rounded square (4x4 supersampling per pixel)
function roundedSquare(c, radius, [r, g, b]) {
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    let hits = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
      const dx = Math.max(radius - px, px - (c.w - radius), 0), dy = Math.max(radius - py, py - (c.h - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) hits++;
    }
    if (hits) over(c, x, y, r, g, b, hits / 16);
  }
}
function save(c, name) { png(path.join(outDir, name), c.w, c.h, c.px); return path.join(outDir, name); }

const LIGHT = [236, 236, 236], DARK = [61, 61, 56], WHITE = [255, 255, 255];
const fullCrop = crop(full, bbox(full));
const symbolCrop = crop(symbolOnly, bbox(crop(symbolOnly, { x: 0, y: 0, w: 700, h: H })));

// 1. Full logo, light, for the About popup and the VC watermark
{ const m = fit(fullCrop, 1200, 1200); const c = canvas(m.w, m.h); paintMask(c, m, 0, 0, LIGHT); save(c, "diakonia-logo.png"); }

// 2. Book symbol, light, on a transparent square for the top bar
{ const S = 256, m = fit(bold(symbolCrop, 64, 0.5), S * 0.94, S * 0.94); const c = canvas(S, S);
  paintMask(c, m, Math.round((S - m.w) / 2), Math.round((S - m.h) / 2), LIGHT); save(c, "diakonia-symbol.png"); }

// 3. Application icon: dark book on a white rounded square, several sizes
const sizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = [];
for (const S of sizes) {
  const c = canvas(S, S);
  roundedSquare(c, S * 0.2, WHITE);
  const pad = S <= 24 ? 0.06 : 0.12;
  const src = S <= 64 ? bold(symbolCrop, S, S <= 24 ? 0.7 : 0.5) : symbolCrop;
  const m = fit(src, S * (1 - 2 * pad), S * (1 - 2 * pad));
  paintMask(c, m, Math.round((S - m.w) / 2), Math.round((S - m.h) / 2), DARK);
  const file = save(c, `icon-${S}.png`);
  icoImages.push({ S, data: fs.readFileSync(file) });
}
// ICO container with PNG entries (supported since Windows Vista)
{
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImages.length, 4);
  const dir = Buffer.alloc(16 * icoImages.length);
  let offset = 6 + dir.length;
  icoImages.forEach((img, i) => {
    const e = i * 16;
    dir[e] = img.S >= 256 ? 0 : img.S; dir[e + 1] = img.S >= 256 ? 0 : img.S;
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.data.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });
  fs.writeFileSync(path.join(outDir, "diakonia.ico"), Buffer.concat([header, dir, ...icoImages.map(i => i.data)]));
}
console.log("ok", fs.readdirSync(outDir).join(" "));
