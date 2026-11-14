export class ExtensionPreferences { constructor() { this.path = '/ext'; } getSettings() { return globalThis.__settings; } }
