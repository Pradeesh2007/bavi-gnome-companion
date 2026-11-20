// Stand-in for resource:///org/gnome/shell/ui/main.js: only what lib/dropzone.js reads (live binding, like the real module).
export let xdndHandler = null;
export function setXdnd(value) { xdndHandler = value; }
