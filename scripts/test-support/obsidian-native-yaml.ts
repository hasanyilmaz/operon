// Use a real YAML codec for native property persistence tests; never bundled into the plugin.
export * from './obsidian';
export { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
// Lifecycle-only modal tests never construct sorting controls.
export class DropdownComponent { constructor() { throw new Error('Dropdown construction is outside this test boundary'); } }
