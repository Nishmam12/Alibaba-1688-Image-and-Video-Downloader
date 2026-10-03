// Renders the app icon (three manifest lines on a navy tile) and writes build/icon.png + build/icon.ico.
// Run with:  npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="58" fill="#14213d"/>
  <rect x="52" y="76" width="152" height="24" rx="12" fill="#7c95ff"/>
  <rect x="52" y="116" width="110" height="24" rx="12" fill="#7c95ff" opacity=".85"/>
  <rect x="52" y="156" width="70" height="24" rx="12" fill="#7c95ff" opacity=".7"/>
</svg>`;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:transparent">${SVG}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  const base = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const out = path.join(__dirname, '..', 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), base.toPNG());
  const pngs = SIZES.map((size) => ({ size, data: base.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(out, 'icon.ico'), buildIco(pngs));
  console.log('ICON_OK', base.getSize());
  app.quit();
});
