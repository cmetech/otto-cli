'use strict';
const fs = require('node:fs');
const path = require('node:path');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

const src = path.resolve(__dirname, '..', 'src', 'defaults');
const dst = path.resolve(__dirname, '..', 'dist', 'defaults');
copyDir(src, dst);
console.log(`Copied persona defaults: ${src} → ${dst}`);
