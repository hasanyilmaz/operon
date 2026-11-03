import { transferLightboxOpening, getLightboxOrigin } from './lightbox';
import { Notice, Platform, TFile, parseLinktext, type App, type WorkspaceLeaf } from 'obsidian';
import { getInternalPlugin, isPluginEnabled } from '../core/obsidian-app';
import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { classifyLocalTaskMediaPreview } from '../core/task-media-preview-kind';
import { getYoutubeEmbedUrl, parseYoutubeVideoUrl } from '../core/youtube-url';
import { nativeLightboxViewType, getLightboxOwnerLeaf, prepareLightboxTab, lightboxFileState, focusLightboxSourceCaret, openFileLightbox, openWebLightbox } from './web-lightbox';
import { openTaskMediaLightbox, type TaskMediaPreviewSource } from './task-media-lightbox';

/** Original references are retained separately from resource/embed URLs. */
export type LightboxTarget =
 | { kind: 'web'; url: string; media?: TaskMediaPreviewSource }
 | { kind: 'local'; linktext: string; sourcePath: string; line?: number; caretCh?: number; operonId?: string; label?: string };
export type LightboxOpenResult = 'opened' | 'missing' | 'unsupported' | 'unavailable';
export interface ResolvedLightboxFile { file: TFile; subpath: string; line?: number; caretCh?: number; operonId?: string }

export function resolveLightboxFile(app: App, target: Extract<LightboxTarget, { kind: 'local' }>): ResolvedLightboxFile | null {
 const raw = target.linktext.trim().replace(/^!?\[\[([\s\S]*)\]\]$/u, '$1').split('|')[0];
 const parsed = parseLinktext(raw);
 const file = app.metadataCache.getFirstLinkpathDest(parsed.path, target.sourcePath);
 return file instanceof TFile ? { file, subpath: parsed.subpath, line: target.line, ...(target.operonId ? { operonId: target.operonId } : {}), ...(target.caretCh !== undefined ? { caretCh: target.caretCh } : {}) } : null;
}

/** Stage 1 callers opt in explicitly; no property or cell routing lives here. */
export async function openLightboxTarget(app: App, anchor: HTMLElement, target: LightboxTarget, mode: 'lightbox' | 'tab' | 'external' = 'lightbox'): Promise<LightboxOpenResult> {
 if (!Platform.isDesktopApp) return 'unsupported';
 if (target.kind === 'web') {
  let url: URL;
  try { url = new URL(target.url); } catch { return 'unsupported'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'unsupported';
  if (mode === 'external') {
   if (target.media) return 'unsupported';
   // Obsidian's own default-browser action uses this target to bypass Web Viewer.
   getOwnerWindow(anchor).open(url.href, '_external', 'noopener');
   return 'opened';
  }
  if (mode === 'tab') return await transferLightboxOpening(anchor, mediaTabOpening(app, anchor, target)) ? 'opened' : 'unavailable';
  const youtube = target.media ? null : parseYoutubeVideoUrl(url.href);
  const media: TaskMediaPreviewSource | undefined = target.media ?? (youtube
   ? {kind: 'youtube', url: getYoutubeEmbedUrl(youtube), label: url.href} : undefined);
  if (media) {
   openTaskMediaLightbox(app, anchor, media, mediaTabOpening(app, anchor, target), mediaTabOpening(app, anchor, target, 'split'), mediaTabOpening(app, anchor, target, 'below'));
   return 'opened';
  }
  return openWebLightbox(app, anchor, url.href) ? 'opened' : 'unavailable';
 }
 if (mode === 'external') return 'unsupported';
 const resolved = resolveLightboxFile(app, target);
 if (!resolved) return 'missing';
 const { file, subpath } = resolved;
 const mediaKind = classifyLocalTaskMediaPreview(file.extension);
 if (!['md', 'base', 'table'].includes(file.extension) && mediaKind === 'unknown') return 'unsupported';
 if (file.extension === 'base' && !isPluginEnabled(getInternalPlugin(app, 'bases'))) {
  new Notice('Enable the bases core plugin to open this base.');
  return 'unavailable';
 }
 if (mode === 'tab') return await transferLightboxOpening(anchor, mediaTabOpening(app, anchor, target)) ? 'opened' : 'unavailable';
 if (mediaKind !== 'unknown') {
  const pdfPage = mediaKind === 'pdf' && /^#page=\d+$/u.test(subpath) ? subpath : '';
  openTaskMediaLightbox(app, anchor, { kind: mediaKind, url: `${app.vault.getResourcePath(file)}${pdfPage}`, label: target.label?.trim() || file.name }, mediaTabOpening(app, anchor, target), mediaTabOpening(app, anchor, target, 'split'), mediaTabOpening(app, anchor, target, 'below'));
 } else openFileLightbox(app, anchor, resolved);
 return 'opened';
}


/** Preserve the original media reference, including PDF page targets and remote watch URLs. */
function mediaTabOpening(app: App, anchor: HTMLElement, target: LightboxTarget, placement: 'tab' | 'split' | 'below' = 'tab'): () => Promise<(() => void) | null> {
 const origin = getLightboxOrigin(anchor) ?? getLightboxOwnerLeaf(app, getOwnerDocument(anchor));
 return async () => {
  try {
   if (target.kind === 'web' && !isPluginEnabled(getInternalPlugin(app, 'webviewer'))) {
    new Notice(t('notifications', 'webViewerUnavailable')); return null;
   }
   const local = target.kind === 'local' ? resolveLightboxFile(app, target) : null;
   if (target.kind === 'local' && !local) { new Notice('This file could not be found.'); return null; }
   let destination: WorkspaceLeaf | null = null;
   const activate = await prepareLightboxTab(app, getOwnerDocument(anchor), async leaf => {
   destination = leaf;
   if (local) await leaf.openFile(local.file, {active: false, eState: lightboxFileState(local)});
   else if (target.kind === 'web') await leaf.setViewState({type: 'webviewer', active: false, state: {url: target.url, navigate: true}});
   await leaf.loadIfDeferred();
   const expected = local ? nativeLightboxViewType(local.file.extension) : 'webviewer';
   if (expected && leaf.view.getViewType() !== expected) throw new Error('Unavailable native view');
   if (leaf.view.containerEl.ownerDocument !== getOwnerDocument(anchor) || (target.kind === 'web' && leaf.view.getViewType() !== 'webviewer')) throw new Error('Unavailable target view');
   }, placement, origin);
   return () => { activate(); if (local && destination) focusLightboxSourceCaret(destination, local); };
  } catch { new Notice(placement === 'below' ? 'Could not open below the original tab. The lightbox is still open.' : placement === 'split' ? 'Could not open to the right of the original tab. The lightbox is still open.' : 'Could not open a new tab. The lightbox is still open.'); return null; }
 };
}
