import fs from 'node:fs';
import path from 'node:path';
import GLib from './glib.mjs';
const QUARK = 'g-io-error-quark';
const IOErrorEnum = {NOT_FOUND: 1, FAILED: 0, CANCELLED: 2};
const FileType = {REGULAR: 1, DIRECTORY: 2};
const wrap = e => e.code === 'ENOENT' ? new GLib.Error(QUARK, IOErrorEnum.NOT_FOUND, `No such file: ${e.path}`) : new GLib.Error(QUARK, IOErrorEnum.FAILED, e.message);
const TYPES = {'.txt': 'text/plain', '.pdf': 'application/pdf', '.sh': 'application/x-shellscript'};
class Info {
    constructor(p, st) { this.p = p; this.st = st; }
    get_file_type() { return this.st.isDirectory() ? FileType.DIRECTORY : FileType.REGULAR; }
    get_size() { return this.st.size; }
    get_display_name() { return path.basename(this.p); }
    get_content_type() { return TYPES[path.extname(this.p)] ?? 'application/octet-stream'; }
    has_attribute() { return true; }
    get_attribute_uint32() { return this.st.mode & 0o777; }
}
class File {
    constructor(p) { this.p = p; }
    static new_for_path(p) { return new File(p); }
    static new_for_uri(u) { return new File(decodeURIComponent(new URL(u).pathname)); }
    get_path() { return this.p; }
    get_uri() { return `file://${this.p}`; }
    get_parent() { return new File(path.dirname(this.p)); }
    query_exists() { return fs.existsSync(this.p); }
    load_contents() { try { return [true, fs.readFileSync(this.p)]; } catch (e) { throw wrap(e); } }
    // asynchronous variants (the real code only uses these): results are delivered on a later turn, like Gio does
    load_contents_async(cancellable, cb) { setImmediate(() => {
        if (cancellable?.cancelled) return cb(this, {error: new GLib.Error(QUARK, IOErrorEnum.CANCELLED, 'Operation was cancelled')});
        try { cb(this, {value: [true, fs.readFileSync(this.p), null]}); } catch (e) { cb(this, {error: wrap(e)}); } }); }
    load_contents_finish(result) { if (result.error) throw result.error; return result.value; }
    query_info_async(attrs, flags, priority, cancellable, cb) { setImmediate(() => {
        try { cb(this, {value: new Info(this.p, fs.statSync(this.p))}); } catch (e) { cb(this, {error: wrap(e)}); } }); }
    query_info_finish(result) { if (result.error) throw result.error; return result.value; }
    replace_contents(bytes) { try { fs.writeFileSync(this.p, bytes, {mode: 0o600}); return [true, null]; } catch (e) { throw wrap(e); } }
    move(target) { try { fs.renameSync(this.p, target.p); } catch (e) { throw wrap(e); } }
    copy(target) { try { fs.copyFileSync(this.p, target.p); } catch (e) { throw wrap(e); } }
    query_info() { try { return new Info(this.p, fs.statSync(this.p)); } catch (e) { throw wrap(e); } }
}
export const launched = [];
export default {
    SettingsBindFlags: {DEFAULT: 0},
    MemoryOutputStream: {new_resizable() { return {chunks: [], closed: false, close() { this.closed = true; }, steal_as_bytes() { const b = Buffer.concat(this.chunks); return {get_data: () => new Uint8Array(b)}; }}; }},
    File, FileType, IOErrorEnum, io_error_quark: () => QUARK,
    FileCreateFlags: {REPLACE_DESTINATION: 1, PRIVATE: 2}, FileCopyFlags: {NONE: 0}, FileQueryInfoFlags: {NONE: 0},
    Cancellable: class { constructor() { this.cancelled = false; } cancel() { this.cancelled = true; } is_cancelled() { return this.cancelled; } }, DBusCallFlags: {NONE: 0, NO_AUTO_START: 1}, DBusSignalFlags: {NONE: 0},
    DBus: {session: {call() {}, signal_subscribe() { return 1; }, signal_unsubscribe() {}, get_unique_name: () => ':1.7'}},
    AppInfo: {
        launch_default_for_uri_async(uri, ctx, c, cb) { launched.push(uri); cb(null, {ok: true}); },
        launch_default_for_uri_finish() { return true; },
    },
};
