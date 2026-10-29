// Extracts text from the course files in "exams studies/" into content/<exam>/sources/*.md
// so every question can be traced back to its source. Re-runnable: `npm run extract`.
//
// Needs: Node 18+, `tar` (bundled with Windows 10+), `pdftotext` (poppler) for PDFs,
// and LibreOffice (`soffice`) only for legacy .ppt files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUDY = path.join(ROOT, 'exams studies');

// Each study folder is its own exam. Never mix them.
const EXAMS = {
  'LEAN & Agile Project Management': 'lean-agile',
  'Outsourcing & Agile Governance': 'outsourcing-governance',
};

// Files that cannot be read yet. Remove the entry once a readable copy is in the folder.
const SKIP = {
  'Intro LEAN Minor IT Mgmt CMI 1 1920 metrics 2026 v2.ppt':
    'unreadable (LibreOffice produces garbage); waiting for a re-saved .pptx/.pdf',
};

const SOFFICE = [
  'C:/Program Files/LibreOffice/program/soffice.exe',
  'C:/Program Files (x86)/LibreOffice/program/soffice.exe',
].find(fs.existsSync) ?? 'soffice';
const TAR = process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar';

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const slug = (name) =>
  name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function unzip(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lah-'));
  execFileSync(TAR, ['-xf', file, '-C', dir]);
  return dir;
}

const paragraphs = (xml) =>
  [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
    .map((p) => [...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decode(t[1])).join(''))
    .filter((s) => s.trim());

function pptxToMarkdown(file) {
  const dir = unzip(file);
  try {
    const slideDir = path.join(dir, 'ppt', 'slides');
    const slides = fs.readdirSync(slideDir)
      .filter((f) => /^slide\d+\.xml$/.test(f))
      .sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
    let out = '';
    for (const f of slides) {
      const n = parseInt(f.slice(5));
      out += `\n## Slide ${n}\n\n${paragraphs(fs.readFileSync(path.join(slideDir, f), 'utf8')).join('\n')}\n`;
      const relPath = path.join(slideDir, '_rels', `${f}.rels`);
      const notes = fs.existsSync(relPath)
        ? fs.readFileSync(relPath, 'utf8').match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)
        : null;
      if (notes) {
        const text = paragraphs(fs.readFileSync(path.join(dir, 'ppt', 'notesSlides', notes[1]), 'utf8'))
          .filter((s) => !/^\d+$/.test(s.trim()));
        if (text.length) out += `\n_Speaker notes:_\n${text.join('\n')}\n`;
      }
    }
    return { text: out, units: `${slides.length} slides` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function pptToMarkdown(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lah-ppt-'));
  try {
    const copy = path.join(tmp, 'in.ppt');
    fs.copyFileSync(file, copy);
    execFileSync(SOFFICE, ['--headless', '--convert-to', 'pptx', '--outdir', tmp, copy], { stdio: 'ignore', timeout: 180000 });
    return pptxToMarkdown(path.join(tmp, 'in.pptx'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function pdfToMarkdown(file) {
  const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const pages = text.split('\f').filter((p) => p.trim());
  return { text: pages.map((p, i) => `\n## Page ${i + 1}\n\n${p.trim()}\n`).join(''), units: `${pages.length} pages` };
}

function xlsxToMarkdown(file) {
  const dir = unzip(file);
  try {
    const xml = fs.readFileSync(path.join(dir, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
    const rows = [...xml.matchAll(/<(?:x:)?row[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)].map((r) =>
      [...r[1].matchAll(/<(?:x:)?v>([^<]*)<\/(?:x:)?v>/g)].map((v) => decode(v[1])));
    return { text: rows.map((r) => `| ${r.join(' | ')} |`).join('\n') + '\n', units: `${rows.length} rows` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HANDLERS = { '.pptx': pptxToMarkdown, '.ppt': pptToMarkdown, '.pdf': pdfToMarkdown, '.xlsx': xlsxToMarkdown };

for (const [folder, examId] of Object.entries(EXAMS)) {
  const srcDir = path.join(STUDY, folder);
  const outDir = path.join(ROOT, 'content', examId, 'sources');
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir).sort()) {
    const handler = HANDLERS[path.extname(name).toLowerCase()];
    if (!handler) continue;
    if (SKIP[name]) { console.log(`SKIP  ${examId}/${name}: ${SKIP[name]}`); continue; }
    try {
      const { text, units } = handler(path.join(srcDir, name));
      const outName = `${slug(name)}.md`;
      fs.writeFileSync(path.join(outDir, outName), `# ${name}\n\n_Extracted text (${units}). Images and diagrams are not included._\n${text}`);
      console.log(`OK    ${examId}/${outName}  (${units}, ${text.length} chars)`);
    } catch (e) {
      console.log(`FAIL  ${examId}/${name}: ${e.message.split('\n')[0]}`);
    }
  }
}
