// Generator for the MuPDF overprint Capability Spike test PDFs (tests 00-12).
//
// Output: scratch/mupdf-spike/input/
//
// Tests follow "Техническое задание по внедрению MuPDF.js" section 22.
// PDFs are built with pdf-lib; Type 4 calculator functions are wrapped in
// braces because MuPDF's pdf_load_calc_function requires the leading '{'.
//
// Test 11 (PDF-compatible AI) and Test 12 (non-compatible AI) are produced
// from the PDF-compatible content / plain PostScript respectively.
//
// Run: node scripts/generate-overprint-tests.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'scratch', 'mupdf-spike', 'input');

const SRGB_ICC = [
  'C:/Windows/System32/spool/drivers/color/sRGB Color Space Profile.icm',
  '/System/Library/ColorSync/Profiles/sRGB Profile.icc',
  '/usr/share/color/icc/ghostscript/srgb.icc',
];

const CMYK_ICC = [
  'C:/Windows/System32/spool/drivers/color/RSWOP.icm',
  'C:/Windows/System32/spool/drivers/color/ISOcoated_v2_300_eci.icc',
  '/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc',
  '/usr/share/color/icc/ghostscript/ps_cmyk.icc',
];

async function loadFirst(paths) {
  for (const path of paths) {
    if (existsSync(path)) {
      try {
        return await readFile(path);
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

function loadSrgbIcc() {
  return loadFirst(SRGB_ICC);
}

function loadCmykIcc() {
  return loadFirst(CMYK_ICC);
}

function enc(text) {
  return new TextEncoder().encode(text);
}

function setContent(pdf, page, text) {
  page.node.set(
    PDFName.of('Contents'),
    pdf.context.register(pdf.context.flateStream(enc(text))),
  );
}

function setResources(pdf, page, resources) {
  page.node.set(PDFName.of('Resources'), pdf.context.obj(resources));
}

// Type 4 (PostScript calculator) function. `code` is the calculator body
// WITHOUT braces; braces are added for MuPDF compatibility.
function addType4Function(pdf, code, { m = 1, outputs = 4 } = {}) {
  const stream = pdf.context.stream(enc(`{ ${code} }`));
  stream.dict.set(PDFName.of('FunctionType'), pdf.context.obj(4));
  const domain = [];
  for (let i = 0; i < m; i += 1) domain.push(0, 1);
  stream.dict.set(PDFName.of('Domain'), pdf.context.obj(domain));
  const range = [];
  for (let i = 0; i < outputs; i += 1) range.push(0, 1);
  stream.dict.set(PDFName.of('Range'), pdf.context.obj(range));
  return pdf.context.register(stream);
}

function separationColorSpace(pdf, name, alternate, fnRef) {
  return pdf.context.obj([
    PDFName.of('Separation'),
    PDFName.of(name),
    pdf.context.obj([PDFName.of(alternate)]),
    fnRef,
  ]);
}

function deviceNColorSpace(pdf, names, alternate, fnRef) {
  return pdf.context.obj([
    PDFName.of('DeviceN'),
    pdf.context.obj(names.map((n) => PDFName.of(n))),
    pdf.context.obj([PDFName.of(alternate)]),
    fnRef,
  ]);
}

function extGState(pdf, props) {
  return pdf.context.obj({ Type: PDFName.of('ExtGState'), ...props });
}

function addOutputIntent(pdf, iccBytes, { subtype = 'GTS_PDFX', info = 'Spike test' } = {}) {
  const profile = pdf.context.register(pdf.context.stream(iccBytes));
  pdf.catalog.set(
    PDFName.of('OutputIntents'),
    pdf.context.obj([
      pdf.context.obj({
        Type: PDFName.of('OutputIntent'),
        S: PDFName.of(subtype),
        OutputConditionIdentifier: 'CGATS TR 001',
        Info: info,
        DestOutputProfile: profile,
      }),
    ]),
  );
  return profile;
}

async function newPage(pdf, size = [400, 400]) {
  return pdf.addPage(size);
}

// Builds a Form XObject stream with a transparency group.
function addTransparencyGroup(pdf, { content, resources = {}, bbox = [0, 0, 400, 400], group }) {
  const stream = pdf.context.flateStream(enc(content));
  stream.dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  stream.dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
  stream.dict.set(PDFName.of('BBox'), pdf.context.obj(bbox));
  stream.dict.set(
    PDFName.of('Group'),
    pdf.context.obj({ S: PDFName.of('Transparency'), ...group }),
  );
  stream.dict.set(PDFName.of('Resources'), pdf.context.obj(resources));
  return pdf.context.register(stream);
}

async function saveTo(pdf, fileName) {
  const bytes = await pdf.save();
  await writeFile(join(OUT_DIR, fileName), Buffer.from(bytes));
  return bytes;
}

// --- test builders ----------------------------------------------------------

// Test 00: baseline CMYK/spot grid with no overprint. Sanity check for the
// render pipeline and CMYK->RGB conversion.
async function buildTest00() {
  const pdf = await PDFDocument.create();
  const page = await newPage(pdf);
  setResources(pdf, page, {});
  setContent(
    pdf,
    page,
    [
      '1 0 0 0 k 0 0 200 200 re f',      // cyan
      '0 1 0 0 k 200 0 200 200 re f',     // magenta
      '0 0 1 0 k 0 200 200 200 re f',     // yellow
      '0 0 0 1 k 200 200 200 200 re f',   // black
    ].join(' '),
  );
  await saveTo(pdf, 'test-00-baseline.pdf');
}

// Test 01: black overprint. Deep red backdrop; a 50% K rectangle and 100% K
// text painted with overprint fill ON. Expectation: backdrop is preserved
// under the black objects (dark red tint, no knockout windows).
async function buildTest01() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = await newPage(pdf);
  setResources(pdf, page, {
    Font: { F1: font.ref },
    ExtGState: { GS: extGState(pdf, { OP: true, op: true }) },
  });
  setContent(
    pdf,
    page,
    [
      '0 0.9 0.85 0 k 0 0 400 400 re f',                          // rich red backdrop
      '/GS gs 0 0 0 0.5 k 60 60 160 160 re f',                    // 50% K overprint
      '/GS gs BT 0 0 0 1 k /F1 24 Tf 40 300 Td (BLACK OVERPRINT) Tj ET',  // 100% K text
    ].join(' '),
  );
  await saveTo(pdf, 'test-01-black-overprint.pdf');
}

// Test 02: black knockout. Same layout as 01 but painted without the
// overprint graphics state. Expectation: objects knock out the backdrop.
async function buildTest02() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = await newPage(pdf);
  setResources(pdf, page, {
    Font: { F1: font.ref },
    ExtGState: {},
  });
  setContent(
    pdf,
    page,
    [
      '0 0.9 0.85 0 k 0 0 400 400 re f',
      '0 0 0 0.5 k 60 60 160 160 re f',
      'BT 0 0 0 1 k /F1 24 Tf 40 300 Td (BLACK KNOCKOUT) Tj ET',
    ].join(' '),
  );
  await saveTo(pdf, 'test-02-black-knockout.pdf');
}

// Test 03: white overprint. Yellow backdrop. Left: white rectangle painted
// with overprint (expect: invisible, backdrop preserved). Right: white
// rectangle painted without overprint (expect: knocks out to paper white).
async function buildTest03() {
  const pdf = await PDFDocument.create();
  const page = await newPage(pdf);
  setResources(pdf, page, {
    ExtGState: { GS: extGState(pdf, { OP: true, op: true }) },
  });
  setContent(
    pdf,
    page,
    [
      '0 0 1 0 k 0 0 400 400 re f',                    // yellow backdrop
      'q /GS gs 0 0 0 0 k 30 100 150 200 re f Q',      // white OVERPRINT (invisible), then restore
      '0 0 0 0 k 220 100 150 200 re f',                // white knockout (paper)
    ].join(' '),
  );
  await saveTo(pdf, 'test-03-white-overprint.pdf');
}

// Test 04: OPM 0 vs OPM 1 with a spot color over a mid-tone backdrop.
// Left column OPM 0 (non-zero components replace), right column OPM 1
// (components added).
async function buildTest04() {
  const pdf = await PDFDocument.create();
  const fn = addType4Function(
    pdf,
    'dup 0 mul exch dup 0.91 mul exch dup 0.72 mul exch 0 mul',
  );
  const page = await newPage(pdf);
  setResources(pdf, page, {
    ColorSpace: { PANTONE185C: separationColorSpace(pdf, 'PANTONE 185 C', 'DeviceCMYK', fn) },
    ExtGState: {
      OPM0: extGState(pdf, { OP: true, op: true, OPM: 0 }),
      OPM1: extGState(pdf, { OP: true, op: true, OPM: 1 }),
    },
  });
  setContent(
    pdf,
    page,
    [
      '0.5 0.5 0 0 k 0 0 400 400 re f',                    // mid purple backdrop
      // OPM 0 column
      '/OPM0 gs /PANTONE185C cs 1 scn 30 60 150 280 re f',
      // OPM 1 column
      '/OPM1 gs /PANTONE185C cs 1 scn 220 60 150 280 re f',
    ].join(' '),
  );
  await saveTo(pdf, 'test-04-opm-0-1.pdf');
}

// Test 05: spot color over CMYK with overprint.
async function buildTest05() {
  const pdf = await PDFDocument.create();
  const fn = addType4Function(
    pdf,
    'dup 0 mul exch dup 0.91 mul exch dup 0.72 mul exch 0 mul',
  );
  const page = await newPage(pdf);
  setResources(pdf, page, {
    ColorSpace: { PANTONE185C: separationColorSpace(pdf, 'PANTONE 185 C', 'DeviceCMYK', fn) },
    ExtGState: { GS: extGState(pdf, { OP: true, op: true }) },
  });
  setContent(
    pdf,
    page,
    [
      '0.2 0.1 0 0.3 k 0 0 400 400 re f',       // CMYK backdrop
      '/GS gs /PANTONE185C cs 0.5 scn 80 80 240 240 re f',  // spot 50% overprint
    ].join(' '),
  );
  await saveTo(pdf, 'test-05-spot-over-cmyk.pdf');
}

// Test 06: DeviceN with two spot colorants. Ink1 contributes cyan, Ink2
// contributes magenta; tints 0.5/1.0 painted with overprint.
async function buildTest06() {
  const pdf = await PDFDocument.create();
  const fn = addType4Function(
    pdf,
    '0 index 0.9 mul 1 index 0.9 mul 0 0',
    { m: 2 },
  );
  const page = await newPage(pdf);
  setResources(pdf, page, {
    ColorSpace: {
      DevN: deviceNColorSpace(pdf, ['INK1', 'INK2'], 'DeviceCMYK', fn),
    },
    ExtGState: { GS: extGState(pdf, { OP: true, op: true }) },
  });
  setContent(
    pdf,
    page,
    [
      '0 0 0.6 0 k 0 0 400 400 re f',      // yellow-ish backdrop
      '/GS gs /DevN cs 0.5 1 scn 80 80 240 240 re f',
    ].join(' '),
  );
  await saveTo(pdf, 'test-06-devicen.pdf');
}

// Test 07: transparency group + spot + overprint. A Form XObject with a
// transparency group contains a semi-transparent overprinted spot rect.
async function buildTest07() {
  const pdf = await PDFDocument.create();
  const fn = addType4Function(
    pdf,
    'dup 0 mul exch dup 0.91 mul exch dup 0.72 mul exch 0 mul',
  );
  const form = addTransparencyGroup(pdf, {
    content:
      '/GS gs /PANTONE185C cs 1 scn 60 60 280 280 re f '
      + '/GSa gs 0 0 1 0 k 160 160 200 200 re f',
    resources: {
      ColorSpace: { PANTONE185C: separationColorSpace(pdf, 'PANTONE 185 C', 'DeviceCMYK', fn) },
      ExtGState: {
        GS: extGState(pdf, { OP: true, op: true }),
        GSa: extGState(pdf, { ca: 0.5, CA: 0.5 }),
      },
    },
    group: {},
  });
  const page = await newPage(pdf);
  setResources(pdf, page, {
    XObject: { Fm0: form },
    ExtGState: {},
  });
  setContent(
    pdf,
    page,
    [
      '0.2 0.4 0 0.2 k 0 0 400 400 re f',   // CMYK backdrop
      'q /Fm0 Do Q',
    ].join(' '),
  );
  await saveTo(pdf, 'test-07-transparency-spot.pdf');
}

// Test 08: knockout groups (isolated / non-isolated / knockout). Three groups
// over a shared backdrop; two overlapping translucent rectangles per group.
async function buildTest08() {
  const pdf = await PDFDocument.create();
  const paint = '0 1 0 0 k 10 10 90 90 re f 1 0 0 0 k 60 60 90 90 re f';
  const nonIsolated = addTransparencyGroup(pdf, {
    content: paint,
    group: { I: false },
    bbox: [0, 0, 120, 120],
  });
  const isolated = addTransparencyGroup(pdf, {
    content: paint,
    group: { I: true },
    bbox: [0, 0, 120, 120],
  });
  const knockout = addTransparencyGroup(pdf, {
    content: paint,
    group: { K: true },
    bbox: [0, 0, 120, 120],
  });
  const page = await newPage(pdf);
  setResources(pdf, page, {
    XObject: { NonIso: nonIsolated, Iso: isolated, Ko: knockout },
    ExtGState: {},
  });
  setContent(
    pdf,
    page,
    [
      '0 0 1 0 k 0 0 400 400 re f',          // yellow backdrop
      'q 1 0 0 1 15 30 cm /NonIso Do Q',
      'q 1 0 0 1 145 30 cm /Iso Do Q',
      'q 1 0 0 1 275 30 cm /Ko Do Q',
    ].join(' '),
  );
  await saveTo(pdf, 'test-08-knockout-groups.pdf');
}

// Test 09: PDF/X-1a flavoured file (flattened, spot + overprint, output
// intent). No transparency groups.
async function buildTest09(iccBytes) {
  const pdf = await PDFDocument.create();
  const fn = addType4Function(
    pdf,
    'dup 0 mul exch dup 0.91 mul exch dup 0.72 mul exch 0 mul',
  );
  const page = await newPage(pdf);
  setResources(pdf, page, {
    ColorSpace: { PANTONE185C: separationColorSpace(pdf, 'PANTONE 185 C', 'DeviceCMYK', fn) },
    ExtGState: { GS: extGState(pdf, { OP: true, op: true }) },
  });
  setContent(
    pdf,
    page,
    [
      '0 0.9 0.85 0 k 0 0 400 400 re f',
      '/GS gs /PANTONE185C cs 1 scn 60 60 280 280 re f',
      '/GS gs 0 0 0 0.5 k 120 120 160 160 re f',
    ].join(' '),
  );
  if (iccBytes) addOutputIntent(pdf, iccBytes, { info: 'PDF/X-1a spike' });
  await saveTo(pdf, 'test-09-pdfx1a.pdf');
}

// Test 10: PDF/X-4 flavoured file (live transparency, spot + ICC, output
// intent).
async function buildTest10(iccBytes) {
  const pdf = await PDFDocument.create();
  const fn = addType4Function(
    pdf,
    'dup 0 mul exch dup 0.91 mul exch dup 0.72 mul exch 0 mul',
  );
  const form = addTransparencyGroup(pdf, {
    content:
      '/GS gs /PANTONE185C cs 1 scn 40 40 320 320 re f '
      + '/GSa gs 0 1 0.5 0 k 140 140 220 220 re f',
    resources: {
      ColorSpace: { PANTONE185C: separationColorSpace(pdf, 'PANTONE 185 C', 'DeviceCMYK', fn) },
      ExtGState: {
        GS: extGState(pdf, { OP: true, op: true }),
        GSa: extGState(pdf, { ca: 0.6, CA: 0.6 }),
      },
    },
    group: {},
  });
  const page = await newPage(pdf);
  setResources(pdf, page, {
    XObject: { Fm0: form },
    ExtGState: {},
  });
  setContent(
    pdf,
    page,
    [
      '0 0.9 0.85 0 k 0 0 400 400 re f',
      'q /Fm0 Do Q',
    ].join(' '),
  );
  if (iccBytes) addOutputIntent(pdf, iccBytes, { info: 'PDF/X-4 spike' });
  await saveTo(pdf, 'test-10-pdfx4.pdf');
}

// Test 11: PDF-compatible AI. Reuses test 01's page, stored with a `.ai`
// extension and an Illustrator trailer block appended after the PDF EOF.
async function buildTest11() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = await newPage(pdf);
  setResources(pdf, page, {
    Font: { F1: font.ref },
    ExtGState: { GS: extGState(pdf, { OP: true, op: true }) },
  });
  setContent(
    pdf,
    page,
    [
      '0 0.9 0.85 0 k 0 0 400 400 re f',
      '/GS gs 0 0 0 0.5 k 60 60 160 160 re f',
      '/GS gs BT 0 0 0 1 k /F1 24 Tf 40 300 Td (PDF COMPATIBLE AI) Tj ET',
    ].join(' '),
  );
  const bytes = await pdf.save();
  const ai = Buffer.concat([
    Buffer.from(bytes),
    Buffer.from('\n%AI12_NotModified: false\n%AI12_BuildNumber: 555\n%%EOF\n'),
  ]);
  await writeFile(join(OUT_DIR, 'test-11-ai-compatible.ai'), ai);
}

// Test 12: non-PDF-compatible AI (plain PostScript). Expectation: the app
// rejects it with AI_NOT_PDF_COMPATIBLE.
async function buildTest12() {
  const content = [
    '%!PS-Adobe-3.0',
    '%%Creator: spike generator',
    '%%Title: Non PDF-compatible AI',
    '%%BoundingBox: 0 0 400 400',
    '100 100 moveto 200 100 lineto 200 200 lineto 100 200 lineto closepath stroke',
    'showpage',
    '%%EOF',
    '',
  ].join('\n');
  await writeFile(join(OUT_DIR, 'test-12-non-compatible-ai.ai'), Buffer.from(content));
}

// --- entry point ------------------------------------------------------------

await mkdir(OUT_DIR, { recursive: true });
const icc = await loadCmykIcc();

const tests = [
  buildTest00,
  buildTest01,
  buildTest02,
  buildTest03,
  buildTest04,
  buildTest05,
  buildTest06,
  buildTest07,
  buildTest08,
  () => buildTest09(icc),
  () => buildTest10(icc),
  buildTest11,
  buildTest12,
];

for (const build of tests) {
  try {
    await build();
  } catch (error) {
    console.error(`FAILED ${build.name}:`, error?.message || error);
    process.exitCode = 1;
  }
}

console.log(`Generated ${tests.length} spike fixtures into ${OUT_DIR}`);
console.log(`ICC profile for PDF/X tests: ${icc ? 'embedded' : 'NOT FOUND (output intents omitted)'}`);
