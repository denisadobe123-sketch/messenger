const sharp = require('sharp');
const path = require('path');

const svgPath = path.join(__dirname, 'public', 'icon.svg');
const sizes = [192, 512];

(async () => {
  for (const size of sizes) {
    await sharp(svgPath, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(path.join(__dirname, 'public', `icon-${size}.png`));
    console.log(`✅ icon-${size}.png`);
  }
  await sharp(svgPath, { density: 384 })
    .resize(180, 180)
    .png()
    .toFile(path.join(__dirname, 'public', 'apple-touch-icon.png'));
  console.log('✅ apple-touch-icon.png');
})();
