// Real tests (plain Node) for lib/name.js. Run: node tests/name.test.mjs
import assert from 'node:assert/strict';
import {normalizeName, storedName, backpackTitle, whoLabel, MAX_NAME_LENGTH, NAME_PLACEHOLDER} from '../lib/name.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1; } };

test('the placeholder is exactly the requested wording', () => {
    assert.equal(NAME_PLACEHOLDER, 'Enter Name (Eg. Bavi)');
});

test('trims surrounding whitespace and accepts ordinary names, including non-Latin and emoji', () => {
    for (const [input, expected] of [['  Bavi  ', 'Bavi'], ['\tMika\n', 'Mika'], ['Anne-Marie', 'Anne-Marie'], ['Zo\u00eb', 'Zo\u00eb'], ['\u30e6\u30ad', '\u30e6\u30ad'], ['\u0928\u093e\u092e', '\u0928\u093e\u092e'], ['Bo \ud83c\udf38', 'Bo \ud83c\udf38'], ['A  B', 'A B']])
        assert.deepEqual(normalizeName(input), {ok: true, name: expected}, JSON.stringify(input));
});

test('NFC normalisation (decomposed e + acute becomes one character)', () => {
    assert.equal(normalizeName('Cafe\u0301').name, 'Caf\u00e9');
});

test('rejects empty, blank and non-string input', () => {
    for (const bad of ['', '   ', '\t\n']) assert.equal(normalizeName(bad).code, 'empty', JSON.stringify(bad));
    for (const bad of [null, undefined, 5, {}, []]) assert.equal(normalizeName(bad).code, 'not-string');
});

test('length limit counts characters (code points), not UTF-16 units', () => {
    assert.equal(normalizeName('a'.repeat(MAX_NAME_LENGTH)).ok, true);
    assert.equal(normalizeName('a'.repeat(MAX_NAME_LENGTH + 1)).code, 'too-long');
    assert.equal(normalizeName('\ud83c\udf38'.repeat(MAX_NAME_LENGTH)).ok, true);          // 32 emoji = 64 UTF-16 units
    assert.equal(normalizeName('\ud83c\udf38'.repeat(MAX_NAME_LENGTH + 1)).code, 'too-long');
});

test('rejects control, invisible, direction-control and malformed characters', () => {
    const bad = ['a\u0000b', 'a\nb', 'a\tb', 'a\u200bb', 'a\u202eb', 'a\u2066b', 'a\ufeffb', 'a\u2028b', 'a\u0085b', 'a\ue000b', 'a\ud800b', 'a\udc00', 'a\u00adb'];
    for (const x of bad) assert.equal(normalizeName(x).code, 'invalid-chars', JSON.stringify(x));
});

test('a leading or trailing BOM is trimmed like whitespace, never stored', () => {
    assert.deepEqual(normalizeName('\ufeffa\ufeff'), {ok: true, name: 'a'});
});

test('markup and shell-like text is just text (accepted, never interpreted)', () => {
    for (const x of ['<b>Bavi</b>', 'a&b', '$(rm -rf ~)', '`x`', "O'Brien", '"Q"', '../../etc'])
        assert.deepEqual(normalizeName(x), {ok: true, name: x});
});

test('a stored value is shown only if it is valid; otherwise the character is unnamed', () => {
    assert.equal(storedName(''), ''); assert.equal(storedName('Bavi'), 'Bavi'); assert.equal(storedName('  Bavi '), 'Bavi');
    for (const bad of ['a'.repeat(99), 'x\u202ey', '\u0000', 42, null, undefined]) assert.equal(storedName(bad), '');
});

test('neutral wording when unnamed, the name when named', () => {
    assert.equal(backpackTitle(''), 'Backpack'); assert.equal(backpackTitle('Mika'), 'Mika\u2019s backpack');
    assert.equal(whoLabel(''), 'the character'); assert.equal(whoLabel('Mika'), 'Mika');
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
