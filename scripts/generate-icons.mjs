import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const assetsDir = path.join(root, 'assets');

async function renderSvgToPng({ svgPath, outPath, size, background }) {
  const svg = await fs.readFile(svgPath);
  const img = sharp(svg, { density: 300 }).resize(size, size, { fit: 'cover' });
  const finalImg = background ? img.flatten({ background }) : img;
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

