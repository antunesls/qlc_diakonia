// Extracts the alpha masks of the Photoshop PDF logo and writes PNGs
const fs = require("fs"), zlib = require("zlib");
const [pdf, outDir] = process.argv.slice(2);
const b = require.main === module ? fs.readFileSync(pdf) : Buffer.alloc(0);
const s = b.toString("latin1");
const W = 1605, H = 455;

function stream(id) {
  const at = s.search(new RegExp("(^|\\s)" + id + " 0 obj"));
  const st = s.indexOf("stream", at);
  const len = +/\/Length (\d+)/.exec(s.slice(at, st))[1];
  let start = st + 6;
  if (s[start] === "\r") start++;
  if (s[start] === "\n") start++;
  return b.subarray(start, start + len);
}

// FlateDecode + TIFF predictor 2 (horizontal differencing)
function gray(id) {
  const raw = zlib.inflateSync(stream(id));
  const px = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = 0; x < W; x++) { acc = (acc + raw[y * W + x]) & 255; px[y * W + x] = acc; }
  }
  return px;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(t, d) {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}
function png(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}
module.exports = { png, W, H };

if (require.main === module) {
  for (const id of [21, 31]) {
    const a = gray(id);
    let sum = 0; for (const v of a) sum += v;
    console.log("mask", id, "mean", (sum / a.length).toFixed(1));
    // preview: black shape on white
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i*4] = rgba[i*4+1] = rgba[i*4+2] = 255 - a[i]; rgba[i*4+3] = 255; }
    png(`${outDir}/mask${id}.png`, W, H, rgba);
    fs.writeFileSync(`${outDir}/mask${id}.raw`, a);
  }
}
