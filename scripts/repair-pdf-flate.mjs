import { readFileSync, writeFileSync } from 'fs';
import { inflateSync } from 'zlib';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.log('usage: node scripts/repair-pdf-flate.mjs <input.pdf> [output.pdf]');
  process.exit(1);
}
const target = output || input.replace(/\.pdf$/i, '.fixed.pdf');
const pdf = readFileSync(input);

function findFlateStreams(bytes) {
  const re = /stream\r?\n/g;
  const streams = [];
  let match;
  while ((match = re.exec(bytes)) !== null) {
    const dataStart = re.lastIndex;
    const endMatch = bytes.indexOf(Buffer.from('endstream'), dataStart);
    if (endMatch < 0) continue;
    const before = bytes.subarray(Math.max(0, dataStart - 1200), dataStart).toString('latin1');
    if (!/\/Filter\s*\/FlateDecode/.test(before) && !/\/Filter\s*\[\s*\/FlateDecode/.test(before)) {
      re.lastIndex = endMatch;
      continue;
    }
    const lengthMatch = before.match(/\/Length\s+(\d+)\b/);
    streams.push({ dataStart, endMatch, declared: lengthMatch ? Number(lengthMatch[1]) : null, lengthMatch });
    re.lastIndex = endMatch;
  }
  return streams;
}

function inflateFrom(bytes, dataStart, length) {
  let start = dataStart;
  if (bytes[start] === 0x0d) start += 1;
  if (bytes[start] === 0x0a) start += 1;
  return inflateSync(bytes.subarray(start, start + length));
}

const streams = findFlateStreams(pdf);
const patched = Buffer.from(pdf);
let fixes = 0;
let remaining = 0;

for (const s of streams) {
  const actual = s.endMatch - s.dataStart;
  if (s.declared === actual) continue;
  try {
    inflateFrom(pdf, s.dataStart, actual);
    if (s.lengthMatch && String(actual).length === String(s.declared).length) {
      patched.write(String(actual), s.lengthMatch.index);
      fixes += 1;
      console.log(`fixed /Length ${s.declared} -> ${actual} (data intact)`);
    } else {
      remaining += 1;
      console.log(`stream at ${s.dataStart}: /Length ${s.declared} != actual ${actual}, data intact but length digits differ`);
    }
  } catch {
    remaining += 1;
    console.log(`stream at ${s.dataStart}: /Length ${s.declared}, data corrupted (cannot recover)`);
  }
}

if (fixes === 0) {
  console.log('no fixable /Length mismatches found');
  process.exit(remaining ? 1 : 0);
}
writeFileSync(target, patched);
console.log(`saved: ${target} (${patched.length} bytes), fixed ${fixes} stream(s), ${remaining} remaining problem(s)`);
process.exit(remaining ? 1 : 0);
