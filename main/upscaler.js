const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, nativeImage } = require('electron');

function binDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin'),
    path.join(app.getAppPath(), 'bin'),
    path.join(__dirname, '..', 'bin'),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'realesrgan-ncnn-vulkan.exe'))) || null;
}

function isAvailable() {
  return !!binDir();
}

function longEdge(file) {
  const { width, height } = nativeImage.createFromPath(file).getSize();
  return Math.max(width, height);
}

function runOnce(exe, cwd, input, output, model, scale) {
  return new Promise((resolve, reject) => {
    const args = ['-i', input, '-o', output, '-n', model, '-s', String(scale), '-f', 'jpg'];
    const child = spawn(exe, args, { cwd, windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`realesrgan exit ${code}: ${err.slice(-300)}`))));
  });
}

// files: absolute paths of downloaded images. Output goes to <product>/images_upscaled/<group>/<name>.jpg
// Skips images already >= skipAtLeast px on the long edge. Runs one at a time (GPU bound).
async function upscaleFiles(files, { skipAtLeast = 1600, model = 'realesrgan-x4plus', scale = 4, outDirName = 'images_upscaled' } = {}, onProgress) {
  const dir = binDir();
  if (!dir) throw new Error('Upscaler not installed. Run: npm run get-upscaler');
  const exe = path.join(dir, 'realesrgan-ncnn-vulkan.exe');
  const out = [];
  let i = 0;
  for (const file of files) {
    i++;
    const outDir = path.join(path.dirname(path.dirname(file)), outDirName, path.basename(path.dirname(file)));
    const dest = path.join(outDir, path.basename(file, path.extname(file)) + '.jpg');
    try {
      if (/\.(gif|bin)$/i.test(file)) { out.push({ file, skipped: 'unsupported' }); continue; }
      const edge = longEdge(file);
      if (!edge) { out.push({ file, skipped: 'unreadable' }); continue; }
      if (edge >= skipAtLeast) { out.push({ file, skipped: `already ${edge}px` }); continue; }
      await fs.promises.mkdir(outDir, { recursive: true });
      await runOnce(exe, dir, file, dest, model, scale);
      out.push({ file, output: dest });
    } catch (e) {
      out.push({ file, error: e.message });
    }
    onProgress && onProgress(i, files.length);
  }
  return out;
}

module.exports = { upscaleFiles, isAvailable };
