import fs from 'node:fs';
export class Error extends globalThis.Error {
    constructor(domain, code, message) { super(message); this.domain = domain; this.code = code; }
    matches(domain, code) { return this.domain === domain && this.code === code; }
}
export class Variant { constructor(t, v) { this.t = t; this.v = v; } }
export class VariantType { constructor(s) { this.s = s; } }
export default {
    Error, Variant, VariantType,
    mkdir_with_parents(p) { fs.mkdirSync(p, {recursive: true}); return 0; },
    uri_unescape_string(s) { return decodeURIComponent(s); },
    build_filenamev(parts) { return parts.join('/'); },
    get_user_data_dir() { return process.env.MOCK_DATA_DIR; },
};
