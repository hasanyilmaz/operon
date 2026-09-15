import { identifyInlineTaskPart, reconcileInlineTaskDom } from './inline-retained-dom';

let sentinelVersion = 0;

/** Group position and parent containers distinguish repeated tasks in separate branches. */
export function reconcileFilterTaskSurface(current: HTMLElement, next: HTMLElement): void {
 const stamp = (container: HTMLElement): void => {
  let group = '';
  let subgroup = '';
  for (const child of Array.from(container.children) as HTMLElement[]) {
   if (child.classList.contains('operon-group-header')) {
    const key = child.dataset.operonFilterGroupKey ?? child.querySelector('.operon-group-header-label')?.textContent ?? '';
    if (child.classList.contains('operon-subgroup-header')) subgroup = key;
    else { group = key; subgroup = ''; }
    identifyInlineTaskPart(child, JSON.stringify(['header', group, subgroup]), child.outerHTML.replace(/operon-accessible-label-\d+/g, 'operon-accessible-label'));
   } else if (child.dataset.operonFilterTaskId) {
    identifyInlineTaskPart(child, JSON.stringify(['task', group, subgroup, child.dataset.operonFilterTaskId, child.dataset.operonFilterTaskPath]), '');
   } else if (child.classList.contains('operon-filter-lazy-sentinel')) {
    // The observer created by this render owns the fresh sentinel.
    identifyInlineTaskPart(child, 'sentinel', String(++sentinelVersion));
   }
   stamp(child);
  }
 };
 stamp(next);
 reconcileInlineTaskDom(current, next, ['operon-embed-header', 'operon-filter-search-wrap', 'operon-embed', 'operon-filter-surface', 'operon-embed-list',
  'operon-filter-task-entry', 'operon-filter-task-children']);
}
