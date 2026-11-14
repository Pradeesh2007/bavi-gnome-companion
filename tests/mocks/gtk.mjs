import {W} from './widget.mjs';
export const launches = [];
class Entry extends W {} class Button extends W {} class Adjustment extends W {} class StringList extends W {}
class Picture extends W { static new_for_filename() { return new Picture(); } }
class UriLauncher { constructor(uri) { this.uri = uri; } static new(uri) { return new UriLauncher(uri); }
    launch(parent, cancellable, cb) { launches.push({uri: this.uri, cb: result => cb(this, result), parent}); } launch_finish(result) { if (result?.fail) throw result.fail; return true; } }
export default {Entry, Button, Adjustment, StringList, Picture, UriLauncher, Align: {CENTER: 2}, DialogError: {DISMISSED: 2}, accelerator_parse: t => [/^<.+>.+$/.test(t)]};
