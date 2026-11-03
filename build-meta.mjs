import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const html = fs.readFileSync('index.html','utf8');
const template = fs.readFileSync('index.template.js','utf8');
if (!template.includes('__REFILL_HTML_JSON__')) {
  throw new Error('Worker template is missing the HTML placeholder.');
}
fs.mkdirSync('dist/server',{recursive:true});
fs.mkdirSync('dist/.openai',{recursive:true});
fs.writeFileSync('dist/index.html', html);
fs.writeFileSync('dist/server/index.js',template.replace('__REFILL_HTML_JSON__',JSON.stringify(html)));
fs.copyFileSync('meta.mjs', 'dist/server/meta.mjs');
fs.copyFileSync('hosting.json','dist/.openai/hosting.json');
console.log('Built Refill Meta test Worker');
