import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const assetsDir = path.join(root, 'assets');

async function renderSvgToPng({ svgPath, outPath, size, background }) {
  const svg = await fs.readFile(svgPath);
  const canvasBg = background ?? { r: 0, g: 0, b: 0, alpha: 0 };
  const contentSize = Math.round(size * 0.78);

  // Avoid the typical "zoomed in" look by rendering the SVG smaller
  // and centering it on a full-size canvas with padding.
  const content = await sharp(svg, { density: 300 })
    .resize(contentSize, contentSize, { fit: 'contain', background: canvasBg })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const composed = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: canvasBg,
    },
  }).composite([{ input: content, gravity: 'center' }]);

  const finalImg = background ? composed.flatten({ background }) : composed;
  await finalImg.png({ compressionLevel: 9 }).toFile(outPath);
}

async function main() {
  const iconSvg = path.join(assetsDir, 'icon-chef-ai.svg');
  const adaptiveSvg = path.join(assetsDir, 'adaptive-icon-chef-ai.svg');

  const iconPng = path.join(assetsDir, 'icon.png');
  const adaptivePng = path.join(assetsDir, 'adaptive-icon.png');

  await renderSvgToPng({
    svgPath: iconSvg,
    outPath: iconPng,
    size: 1024,
    background: '#F7F4EE',
  });

  await renderSvgToPng({
    svgPath: adaptiveSvg,
    outPath: adaptivePng,
    size: 1024,
    background: null,
  });

  console.log('Generated assets/icon.png and assets/adaptive-icon.png');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

