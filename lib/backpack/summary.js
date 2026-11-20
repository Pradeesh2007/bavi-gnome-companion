// lib/backpack/summary.js
//
// One wording for "what happened to what you handed over" (Paste, drop onto the character). Pure.

const NOUN = {file: ['file', 'files'], link: ['link', 'links'], text: ['note', 'notes']};

function countText(items) {
    return ['file', 'link', 'text']
        .map(kind => [kind, items.filter(i => i.kind === kind).length]).filter(([, n]) => n > 0)
        .map(([kind, n]) => `${n} ${NOUN[kind][n === 1 ? 0 : 1]}`).join(' and ');
}

/**
 * @param {{added: object[], skipped: {name: string, reason: string, code?: ?string}[]}} result from service.receive()
 * @param {{what: string, reason: string}[]} rejected items refused by intake.js before storing
 * @param {string} destination 'backpack' | 'pocket' (where the caller asked to store)
 * @param {{clipboardHint?: boolean}} [options] clipboardHint: the content is still on the clipboard (Paste only)
 * @returns {{text: string, error: boolean}} error is true when nothing was stored
 */
export function summariseReceive(result, rejected, destination, {clipboardHint = false} = {}) {
    const place = destination === 'backpack' ? 'the backpack' : 'the pocket';
    const parts = [];
    const direct = result.added.filter(i => !i.viaPocket);
    const pocketed = result.added.filter(i => i.viaPocket);
    if (direct.length)
        parts.push(`Added ${countText(direct)} to ${place}.`);
    if (pocketed.length)
        parts.push(`The backpack is full, so ${countText(pocketed)} went into the pocket (kept for a while). Remove something, then press Keep to move ${pocketed.length === 1 ? 'it' : 'them'} to the backpack.`);
    const problems = [...result.skipped.map(x => ({what: x.name, reason: x.reason})), ...rejected];
    for (const p of problems.slice(0, 3))
        parts.push(`Skipped ${p.what}: ${p.reason}`);
    if (problems.length > 3)
        parts.push(`\u2026and ${problems.length - 3} more skipped.`);
    if (result.skipped.some(x => x.code === 'slots-full' || x.code === 'pocket-full')) {
        parts.push(clipboardHint
            ? 'Nothing was replaced or removed. The content is still on your clipboard: make room (or switch the destination) and press Paste again.'
            : 'Nothing was replaced or removed. The item is unchanged where it came from.');
    }
    return {text: parts.join('\n'), error: result.added.length === 0};
}
