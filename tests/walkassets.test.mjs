// MOCKED-Gio tests of lib/character/walkassets.js (the real loader and validation; Gio is a stand-in that reads real files).
// Run: node --import ./tests/mocks/register.mjs tests/walkassets.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Gio from 'gi://Gio';
import {loadWalkAssets} from '../lib/character/walkassets.js';

const real = fileURLToPath(new URL('../assets/walk', import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bavi-walk-'));
const capture = async fn => { const e = console.error, l = console.log; const out = []; console.error = (...a) => out.push(a.join(' ')); console.log = (...a) => out.push(a.join(' ')); try { return [await fn(), out]; } finally { console.error = e; console.log = l; } };
let passed = 0; const tests = []; const test = (n, f) => tests.push([n, f]);

test('the shipped assets load asynchronously and point at the real atlas', async () => {
    const [r, out] = await capture(() => loadWalkAssets(real, new Gio.Cancellable()));
    assert.ok(r && r.manifest.sequences.loop.frames.length === 10); assert.equal(r.atlasPath, `${real}/walk.png`); assert.equal(fs.existsSync(r.atlasPath), true); assert.deepEqual(out, []);
});

test('a missing walk.json, an invalid manifest and a missing atlas all resolve to null with a logged reason (no throw, no broken state)', async () => {
    const empty = tmp(); const [a, outA] = await capture(() => loadWalkAssets(empty)); assert.equal(a, null); assert.match(outA.join('|'), /could not load assets/);
    const bad = tmp(); fs.writeFileSync(`${bad}/walk.json`, JSON.stringify({version: 1})); const [b, outB] = await capture(() => loadWalkAssets(bad)); assert.equal(b, null); assert.match(outB.join('|'), /invalid walk\.json/);
    const noAtlas = tmp(); fs.copyFileSync(`${real}/walk.json`, `${noAtlas}/walk.json`); const [c, outC] = await capture(() => loadWalkAssets(noAtlas)); assert.equal(c, null); assert.match(outC.join('|'), /walk\.png is missing/);
    const junk = tmp(); fs.writeFileSync(`${junk}/walk.json`, '{ not json'); assert.equal((await capture(() => loadWalkAssets(junk)))[0], null);
});

test('a cancelled load (the extension was disabled) resolves to null silently', async () => {
    const c = new Gio.Cancellable(); const p = loadWalkAssets(real, c); c.cancel();
    const [r, out] = await capture(() => p); assert.equal(r, null); assert.deepEqual(out.filter(l => /disabled|failed/.test(l)), []);
});

for (const [name, fn] of tests) {
    let error = null; try { await fn(); } catch (e) { error = e; }
    if (error) { process.exitCode = 1; console.log(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 5).join('\n     ')}`); } else { passed++; console.log(`ok   ${name}`); }
}
console.log(`\n${passed}/${tests.length} passed (MOCKED Gio; real walkassets.js and walk.js)`);
