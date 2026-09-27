#!/usr/bin/env node
/**
 * Распаковка сырых ajx-дампов: {"CODE","DATA","DATA2","DATA3"} -> отдельные HTML-файлы.
 * Использование: node tools/split-dumps.mjs [dumps/<папка>]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dumps');
const files = fs.readdirSync(dir).filter((f) => f.startsWith('ajx-') && f.endsWith('.raw.txt'));

for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    console.log(`${f}: not JSON, skipped`);
    continue;
  }
  const base = f.replace('.raw.txt', '');
  for (const [key, val] of Object.entries(j)) {
    if (key === 'CODE') {
      console.log(`${f}: CODE = ${val}`);
      continue;
    }
    const out = path.join(dir, `${base}.${key}${typeof val === 'string' ? '.html' : '.json'}`);
    fs.writeFileSync(out, typeof val === 'string' ? val : JSON.stringify(val, null, 2));
    console.log(`${f}: ${key} (${Array.isArray(val) ? 'array' : typeof val}) -> ${path.basename(out)}`);
  }
}
