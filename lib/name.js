// lib/name.js
//
// Optional character name. Pure logic (no imports), used by prefs.js (to validate what the user types) and by the
// extension (to treat a stored value defensively, because GSettings can also be edited with gsettings/dconf).
//
// A fresh installation has NO name: the stored value is the empty string and nothing is shown in its place.

export const MAX_NAME_LENGTH = 32;          // in Unicode code points
export const NAME_PLACEHOLDER = 'Enter Name (Eg. Bavi)';   // exact wording requested by the developer; shown in prefs

const REASONS = {
    'not-string': 'The name must be text.',
    'empty': 'Please type a name first, or use Clear to remove the name.',
    'too-long': `Names can be at most ${MAX_NAME_LENGTH} characters long.`,
    'invalid-chars': 'The name contains characters that are not allowed (control, invisible or direction-changing characters).',
};

// Control characters, line/paragraph separators, zero-width and direction-control characters, BOM, private use.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ue000-\uf8ff\ufff9-\ufffb]/u;

/** True when the string contains a lone (unpaired) surrogate. */
function hasLoneSurrogate(text) {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff)
                i++;
            else
                return true;
        } else if (c >= 0xdc00 && c <= 0xdfff) {
            return true;
        }
    }
    return false;
}

/**
 * Validates and normalises a name typed by the user.
 * Trims surrounding whitespace, normalises to NFC, collapses runs of spaces, rejects empty names, over-long names
 * and unsafe characters.
 * @returns {{ok: true, name: string} | {ok: false, code: string, message: string}}
 */
export function normalizeName(input) {
    const fail = code => ({ok: false, code, message: REASONS[code]});
    if (typeof input !== 'string')
        return fail('not-string');
    if (hasLoneSurrogate(input))
        return fail('invalid-chars');
    let name = input.normalize('NFC').trim();
    if (name === '')
        return fail('empty');
    if (FORBIDDEN.test(name))
        return fail('invalid-chars');
    name = name.replace(/ {2,}/g, ' ');
    if ([...name].length > MAX_NAME_LENGTH)
        return fail('too-long');
    return {ok: true, name};
}

/**
 * Interprets a value read from settings: a valid name, or '' (unnamed). An invalid stored value (for example written
 * with gsettings) is treated as unnamed rather than shown.
 */
export function storedName(value) {
    if (typeof value !== 'string' || value === '')
        return '';
    const result = normalizeName(value);
    return result.ok ? result.name : '';
}

/** Title of the backpack window: neutral when unnamed. */
export function backpackTitle(name) {
    return name ? `${name}\u2019s backpack` : 'Backpack';
}

/** The name, or neutral wording for sentences like "Hide <who>". */
export function whoLabel(name) {
    return name || 'the character';
}
