// PNGs for tests: w×h pixels of 3 (RGB) or 4 (RGBA) bytes, each row with one of the filters a PNG writer uses
const zlib = require('zlib');

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
module.exports = (w, h, bpp, px, filters = [0]) => {
  const stride = w * bpp;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const f = filters[y % filters.length];
    const row = Buffer.alloc(stride + 1);
    row[0] = f;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      row[x + 1] = (px[y * stride + x] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
    }
    rows.push(row);
  }
  const chunk = (kind, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(kind, 'ascii'), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = bpp === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};
// a w×h picture of one colour, with a w×(h·share) block of another at its foot
module.exports.solid = (w, h, bpp, colour, block = null, share = 0) => {
  const px = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) (block && y >= h * (1 - share) ? block : colour).forEach((v, k) => { px[(y * w + x) * bpp + k] = v; });
  return px;
};
