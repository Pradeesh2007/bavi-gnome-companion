export const clip = {copied: null, set_text(t) { this.copied = t; }};
export default {Display: {get_default: () => ({get_clipboard: () => clip})}};
