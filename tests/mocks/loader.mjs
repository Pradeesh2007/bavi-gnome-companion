// Node module hooks: maps the gi:// and Shell resource:// imports to the stand-ins in this folder. NOT the real libraries.
const MAP = {
    'gi://Gio': 'gio.mjs', 'gi://GLib': 'glib.mjs',
    'gi://Clutter': 'clutter.mjs', 'gi://Pango': 'pango.mjs', 'gi://St': 'st.mjs',
    'resource:///org/gnome/shell/ui/modalDialog.js': 'modaldialog.mjs',
};
export async function resolve(specifier, context, next) {
    if (MAP[specifier])
        return {url: new URL(`./${MAP[specifier]}`, import.meta.url).href, shortCircuit: true};
    return next(specifier, context);
}
