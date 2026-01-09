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
    
    // Try to find node.exe on the system
    let sourceNodePath = null;
    
    const possiblePaths = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'node.exe')
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        sourceNodePath = p;
        break;
      }
    }
    
    // If we can't find it in standard locations, try using 'where node' command
    if (!sourceNodePath) {
      try {
        const output = execSync('where node', { encoding: 'utf8' });
        const paths = output.split('\n').map(p => p.trim()).filter(Boolean);
        if (paths.length > 0) {
          sourceNodePath = paths[0];
        }
      } catch (err) {
        console.warn('Could not locate node.exe using "where" command');
      }
    }
    
    if (sourceNodePath && fs.existsSync(sourceNodePath)) {
      console.log(`Copying node.exe from: ${sourceNodePath}`);
      fs.copyFileSync(sourceNodePath, targetNodePath);
      console.log(`✓ node.exe bundled successfully at: ${targetNodePath}`);
    } else {
      console.warn('⚠️  Warning: Could not find node.exe to bundle with the app.');
      console.warn('   Users will need to have Node.js installed on their system.');
    }
  }
};
