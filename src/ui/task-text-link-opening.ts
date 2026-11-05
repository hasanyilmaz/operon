import { Platform, type App } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import { getTaskDisplayTitle } from '../core/task-display-title';
import { parseCompactTaskMarkdown, type CompactTaskMarkdownLink, type CompactTaskMarkdownNode } from './compact-task-markdown-renderer';
import { bindResolvedChipOpening, type ChipOpeningDecision } from './links-chip-action';
import { resolveLightboxFile, type LightboxTarget } from './lightbox-opening';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';

export interface TaskTextLinkSource { value: string; sourcePath: string }
export function markdownLinkDestination(link: CompactTaskMarkdownLink): string {
 return link.type === 'wikilink' ? link.target : link.destination;
}
export function containsTaskTextLink(nodes: CompactTaskMarkdownNode[], destination: string): boolean {
 return nodes.some(node => node.type === 'wikilink' || node.type === 'markdown-link'
  ? markdownLinkDestination(node) === destination
  : 'children' in node && containsTaskTextLink(node.children, destination));
}
export function resolveTaskTextLink(app: App, link: CompactTaskMarkdownLink, source: TaskTextLinkSource | null, validate = true): ChipOpeningDecision {
 if (!source || validate && !containsTaskTextLink(parseCompactTaskMarkdown(source.value), markdownLinkDestination(link))) return {kind:'missing'};
 if (link.type === 'markdown-link' && link.external) return /^https?:\/\//iu.test(link.destination)
  ? {kind:'target',target:{kind:'web',url:link.destination}} : {kind:'missing'};
 const target: LightboxTarget = {kind:'local',linktext:markdownLinkDestination(link),sourcePath:source.sourcePath};
 return resolveLightboxFile(app,target) ? {kind:'target',target} : {kind:'missing'};
}
export function bindTaskTextOpening(app: App, read: () => TaskTextLinkSource | null, canActivate?: () => boolean): ((anchor: HTMLElement, link: CompactTaskMarkdownLink) => void) | undefined {
 if (!Platform.isDesktopApp) return undefined;
 return (anchor,link) => {
  anchor.draggable = false;
  anchor.addEventListener('dragstart',event=>event.preventDefault());
  if (link.type === 'markdown-link' && link.external) bindOperonHoverTooltip(anchor,{content:link.destination,taskColor:null});
  bindResolvedChipOpening(anchor,{app,resolve:()=>resolveTaskTextLink(app,link,read()),canActivate,stopPointerDown:true});
 };
}
export function taskDescriptionOpening(app: App, read: () => Pick<IndexedTask, 'description' | 'fieldValues' | 'primary'> | null | undefined, canActivate?: () => boolean, displayTitleEnabled = false): ReturnType<typeof bindTaskTextOpening> {
 return bindTaskTextOpening(app,()=>{const task=read();return task?{value:getTaskDisplayTitle(task, displayTitleEnabled),sourcePath:task.primary.filePath}:null;},canActivate);
}
