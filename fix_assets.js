const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'www', 'assets', 'logo.png'); // Or icon.png
const destLogo = path.join(__dirname, 'assets', 'logo.png');
const destSplash = path.join(__dirname, 'assets', 'splash.png');
const destWebIcon = path.join(__dirname, 'www', 'assets', 'icon.png');

try {
    // Ensure assets dir exists
    if (!fs.existsSync(path.join(__dirname, 'assets'))) {
        fs.mkdirSync(path.join(__dirname, 'assets'));
    }
    
    // Check if source exists. If not, try icon.png
    let sourceFile = src;
    if (!fs.existsSync(src)) {
        console.log("Logo.png not found in www/assets, trying www/assets/icon.png");
        sourceFile = path.join(__dirname, 'www', 'assets', 'icon.png');
    }

    if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, destLogo);
        fs.copyFileSync(sourceFile, destSplash);
        fs.copyFileSync(sourceFile, destWebIcon);
        console.log("✅ Assets copied successfully!");
    } else {
        console.error("❌ No source image found in www/assets/!");
    }
} catch (e) {
    console.error("Error:", e);
}
