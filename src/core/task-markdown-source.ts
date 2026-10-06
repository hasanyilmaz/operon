import type { TFile } from 'obsidian';

/** A short-lived, file-owned write port; ordinary task writes keep their existing path. */
export interface TaskMarkdownSource {
 readonly file: TFile;
 read(): Promise<string>;
 write(expected: string, next: string, canCommit?: () => boolean): Promise<string>;
}
