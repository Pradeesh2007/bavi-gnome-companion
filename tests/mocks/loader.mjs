// Node module hooks: maps gi://Gio and gi://GLib to the stand-ins in this folder. NOT the real libraries.
export async function resolve(specifier, context, next) {
    if (specifier === 'gi://Gio' || specifier === 'gi://GLib')
        return {url: new URL(`./${specifier.slice(5).toLowerCase()}.mjs`, import.meta.url).href, shortCircuit: true};
    return next(specifier, context);
}
