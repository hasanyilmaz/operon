/** Preserve explicit newlines when seeding a task from a surface's plain text. */
export function splitTaskCreationText(text: string): { description: string; note: string } {
 const lines = text.replace(/\r\n?/g, '\n').split('\n'); return { description: lines.shift() ?? '', note: lines.join('\n') };
}
