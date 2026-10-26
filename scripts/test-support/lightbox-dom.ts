export function lightboxFixture() {
 const listeners = new Map<string, Set<(event: any) => void>>();
 const doc: any = { activeElement: null, querySelectorAll() { return []; }, addEventListener(k: string, fn: (e: any) => void) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)!.add(fn); }, removeEventListener(k: string, fn: (e: any) => void) { listeners.get(k)?.delete(fn); } };
 class Element {
  ownerDocument = doc; children: Element[] = []; parent: Element | null = null; dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; tagName = 'DIV'; id = ''; textContent = ''; connected = true;
  private cssProperties: Record<string, string> = {};
  style = {setProperty: (key: string, value: string) => { this.cssProperties[key] = value; }, getPropertyValue: (key: string) => this.cssProperties[key] ?? '', removeProperty: (key: string) => { const value = this.cssProperties[key]; delete this.cssProperties[key]; return value; }}; classes = new Set<string>();
  events = new Map<string, (event: any) => void>();
  get isConnected(): boolean { return this.connected && (!this.parent || this.parent.isConnected); }
  setText(text: string) { this.textContent = text; this.children = []; }
  addClass(name: string) { for (const item of name.split(' ')) this.classes.add(item); }
  removeClass(name: string) { this.classes.delete(name); }
  toggleClass(name: string, yes: boolean) { if (yes) this.classes.add(name); else this.classes.delete(name); }
  closest() { return null; }
  getClientRects() { return this.attrs.hidden === '' ? [] : [this.getBoundingClientRect()]; }
  getBoundingClientRect() { return {left:10,top:10,bottom:30,width:100,height:80}; }
  querySelectorAll(): Element[] { return this.children.flatMap(el => [el, ...el.querySelectorAll()]); }
  createSpan(options?: any) { return this.createEl('span',options); }
  removeEventListener(k: string) { this.events.delete(k); } setAttribute(k: string, v: string) { this.attrs[k] = v; } removeAttribute(k: string) { delete this.attrs[k]; } getAttribute(k: string) { return this.attrs[k] ?? null; }
  querySelector() { return null; }
  appendChild(el: Element) { if (el.parent) el.parent.children = el.parent.children.filter(child => child !== el); el.parent = this; this.children.push(el); const adopt = (node: Element): void => { node.ownerDocument = this.ownerDocument; for (const child of node.children) adopt(child); }; adopt(el); return el; }
  createDiv(options?: any) { return this.createEl('div', options); }
  createEl(tag: string, options?: any) { const el = new Element(); el.tagName = tag.toUpperCase(); el.textContent = options?.text ?? ''; if (typeof options === 'string') el.addClass(options); else if (options?.cls) el.addClass(options.cls); return this.appendChild(el); }
  addEventListener(k: string, fn: (event: any) => void) { this.events.set(k, fn); }
  contains(el: Element): boolean { return el === this || this.children.some(child => child.contains(el)); }
  focus() { doc.activeElement = this; }
  remove() { this.connected = false; }
 }
 doc.getElementById = (id: string) => doc.body.querySelectorAll().find((el: Element) => el.id === id) ?? null;
 doc.defaultView = { HTMLElement: Element, ResizeObserver: class { observe() {} disconnect() {} }, getComputedStyle: () => ({borderTopRightRadius: '12px'}), innerWidth:1200, innerHeight:900, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} }; doc.win = { createSpan: () => new Element() }; doc.body = new Element();
 const anchor = doc.body.createDiv(); anchor.focus();
 return { doc, anchor: anchor as unknown as HTMLElement, listeners, emit: (key: string, event: any) => [...(listeners.get(key) ?? [])].forEach(fn => fn(event)) };
}
