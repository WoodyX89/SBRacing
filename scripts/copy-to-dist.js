const fs = require('fs');
const path = require('path');

const root = process.cwd();
const dist = path.join(root, 'dist');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

// clean + recreate
rmrf(dist);
fs.mkdirSync(dist, { recursive: true });

// root HTML
for (const name of fs.readdirSync(root)) {
  if (name.endsWith('.html')) {
    copyFile(path.join(root, name), path.join(dist, name));
  }
}

// folders the site needs
['css', 'js', 'partials', 'assets'].forEach((dir) => {
  copyDir(path.join(root, dir), path.join(dist, dir));
});

// optional root files
['manifest.json', 'sw.js', 'robots.txt', 'favicon.ico'].forEach((file) => {
  const src = path.join(root, file);
  if (fs.existsSync(src)) copyFile(src, path.join(dist, file));
});

console.log('Built dist/ for Capacitor');