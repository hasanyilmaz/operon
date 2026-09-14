import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { cleanupOperonRenderRoot } from './render-root-cleanup';

const identities = new WeakMap<HTMLElement, string>();
const signatures = new WeakMap<HTMLElement, string>();

/** Only the inline task renderers opt in. Dynamic hover/image DOM is not a render signature. */
export function identifyInlineTaskPart(element: HTMLElement, key: string, signature: string): void {
 identities.set(element, key);
 signatures.set(element, signature);
}

function markup(element: HTMLElement): string {
 return element.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label');
}

function identity(element: HTMLElement, index: number): string {
 return identities.get(element) ?? `${element.tagName}:${index}`;
}

export function rememberInlineTaskDom(root: HTMLElement): void {
 if (!signatures.has(root)) signatures.set(root, markup(root));
 for (const child of Array.from(root.children)) rememberInlineTaskDom(child as HTMLElement);
}

/** Reconcile structural containers; leaves with changed bindings are replaced independently. */
export function reconcileInlineTaskDom(current: HTMLElement, next: HTMLElement): void {
 const containers = new Set(['operon-live-preview-tail', 'operon-live-preview-tail-wrap',
  'operon-live-preview-tail-row', 'operon-live-preview-tail-actions', 'operon-reading-task-row',
  'operon-reading-task-head', 'operon-reading-task-tail', 'operon-reading-task-actions', 'operon-reading-task-tail-wrap']);
 const isContainer = (el: HTMLElement) => Array.from(el.classList).some(name => containers.has(name));
 const sync = (old: HTMLElement, fresh: HTMLElement): HTMLElement => {
  if (!isContainer(old) && signatures.get(old) === signatures.get(fresh)) { cleanupOperonRenderRoot(fresh); return old; }
  const action = identities.get(old);
  if (action && ['timer', 'pin', 'status-icon'].includes(action) && action === identities.get(fresh) && old.tagName === fresh.tagName) {
   for (const name of old.getAttributeNames()) if (!fresh.hasAttribute(name)) old.removeAttribute(name);
   for (const name of fresh.getAttributeNames()) { const value = fresh.getAttribute(name)!; if (old.getAttribute(name) !== value) old.setAttribute(name, value); }
   old.replaceChildren(...Array.from(fresh.childNodes));
   if (action !== 'status-icon') {
    cleanupOperonHoverTooltips(old);
    bindOperonHoverTooltip(old, { content: old.querySelector('[data-operon-accessible-label]')?.textContent ?? '',
     taskColor: old.style.getPropertyValue('--operon-live-hover-border') || null });
   }
   signatures.set(old, signatures.get(fresh) ?? markup(fresh));
   cleanupOperonRenderRoot(fresh);
   return old;
  }
  if (!isContainer(old) || !isContainer(fresh) || old.tagName !== fresh.tagName) {
   cleanupOperonRenderRoot(old);
   return fresh;
  }
  for (const name of old.getAttributeNames()) if (!fresh.hasAttribute(name)) old.removeAttribute(name);
  for (const name of fresh.getAttributeNames()) { const value = fresh.getAttribute(name)!; if (old.getAttribute(name) !== value) old.setAttribute(name, value); }
  const prior = new Map<string, HTMLElement[]>();
  Array.from(old.children).forEach((child, index) => { const key = identity(child as HTMLElement, index); const queue = prior.get(key) ?? []; queue.push(child as HTMLElement); prior.set(key, queue); });
  let cursor = old.firstElementChild;
  Array.from(fresh.children).forEach((child, index) => {
   const incoming = child as HTMLElement;
   const key = identity(incoming, index);
   const queue = prior.get(key);
   const existing = queue?.shift();
   if (!queue?.length) prior.delete(key);
   const retained = existing ? sync(existing, incoming) : incoming;
   if (retained !== cursor) old.insertBefore(retained, cursor);
   else cursor = cursor.nextElementSibling;
   if (existing && retained !== existing) { if (cursor === existing) cursor = existing.nextElementSibling; existing.remove(); }
  });
  for (const obsolete of Array.from(prior.values()).flat()) { cleanupOperonRenderRoot(obsolete); obsolete.remove(); }
  signatures.set(old, signatures.get(fresh) ?? markup(fresh));
  return old;
 };
 rememberInlineTaskDom(next);
 sync(current, next);
 cleanupOperonRenderRoot(next);
}
