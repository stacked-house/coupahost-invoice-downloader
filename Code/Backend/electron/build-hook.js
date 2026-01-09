const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * AfterPack hook to bundle node.exe with the Windows build
 * This ensures the app works even on machines without Node.js installed
 */
exports.default = async function(context) {
  if (context.electronPlatformName === 'win32') {
    console.log('Bundling node.exe with Windows build...');
    
    const appOutDir = context.appOutDir;
    const targetNodePath = path.join(appOutDir, 'node.exe');
    
    // Use the pre-downloaded node.exe from bundled-binaries
    const sourceNodePath = path.join(__dirname, 'bundled-binaries', 'node.exe');
    
    if (fs.existsSync(sourceNodePath)) {
      console.log(`Copying node.exe from: ${sourceNodePath}`);
      fs.copyFileSync(sourceNodePath, targetNodePath);
      console.log(`✓ node.exe bundled successfully at: ${targetNodePath}`);
    } else {
      console.error('❌ Error: bundled-binaries/node.exe not found!');
      console.error('   Please download node.exe first.');
      throw new Error('node.exe not found in bundled-binaries/');
    }
  }
};
