export function lightboxFixture() {
 const listeners = new Map<string, Set<(event: any) => void>>();
 const doc: any = { activeElement: null, addEventListener(k: string, fn: (e: any) => void) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(fn); }, removeEventListener(k: string, fn: (e: any) => void) { listeners.get(k)?.delete(fn); } };
 class Element {
  ownerDocument = doc; children: Element[] = []; parent: Element | null = null; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; tagName = 'DIV'; id = ''; textContent = ''; connected = true;
  events = new Map<string, (event: any) => void>();
  get isConnected(): boolean { return this.connected && (!this.parent || this.parent.isConnected); }
  addClass() {} setAttribute(k: string, v: string) { this.attrs[k] = v; } removeAttribute(k: string) { delete this.attrs[k]; }
  querySelector() { return null; }
  appendChild(el: Element) { el.parent = this; this.children.push(el); return el; }
  createDiv(options?: any) { return this.createEl('div', options); }
  createEl(tag: string, options?: any) { const el = new Element(); el.tagName = tag.toUpperCase(); el.textContent = options?.text ?? ''; return this.appendChild(el); }
  addEventListener(k: string, fn: (event: any) => void) { this.events.set(k, fn); }
  contains(el: Element): boolean { return el === this || this.children.some(child => child.contains(el)); }
  focus() { doc.activeElement = this; }
  remove() { this.connected = false; }
 }
 doc.defaultView = { HTMLElement: Element, addEventListener() {}, removeEventListener() {} }; doc.win = { createSpan: () => new Element() }; doc.body = new Element();
 const anchor = doc.body.createDiv(); anchor.focus();
 return { doc, anchor: anchor as unknown as HTMLElement, listeners, emit: (key: string, event: any) => [...(listeners.get(key) ?? [])].forEach(fn => fn(event)) };
}
