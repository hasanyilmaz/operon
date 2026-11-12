/** Stable section identities; visual labels are localized by the settings UI. */
export const STATUS_DOCK_SECTION_IDS = [
 'overdueToday', 'tracker', 'creator', 'ongoing', 'upcoming', 'pinned', 'modified', 'history',
] as const;
export type StatusDockSectionId = typeof STATUS_DOCK_SECTION_IDS[number];
export interface StatusDockSection { id: StatusDockSectionId; enabled: boolean }

/** Future sections retain their settings but are not rendered until implemented. */
export const STATUS_DOCK_AVAILABLE_SECTION_IDS: readonly StatusDockSectionId[] = [
 'overdueToday', 'tracker', 'creator', 'ongoing', 'upcoming', 'pinned', 'modified', 'history',
];

export function normalizeStatusDockSections(value: unknown): StatusDockSection[] {
 return normalizeSections(value, true);
}

/** Preserve an implicit Creator when reading or saving unrelated settings. */
export function normalizeStoredStatusDockSections(value: unknown): StatusDockSection[] {
 return normalizeSections(value, false);
}

function normalizeSections(value: unknown, includeCreatorDefault: boolean): StatusDockSection[] {
 const result: StatusDockSection[] = [];
 const seen = new Set<StatusDockSectionId>();
 for (const item of Array.isArray(value) ? value : []) {
  if (!item || typeof item !== 'object') continue;
  const { id, enabled } = item as Record<string, unknown>;
  if (typeof id !== 'string' || !STATUS_DOCK_SECTION_IDS.some(key => key === id)) continue;
  const sectionId = id as StatusDockSectionId;
  if (seen.has(sectionId)) continue;
  seen.add(sectionId);
  result.push({ id: sectionId, enabled: enabled !== false });
 }
 for (const id of STATUS_DOCK_SECTION_IDS) {
  if (seen.has(id)) continue;
  if (id === 'creator') {
   if (includeCreatorDefault) result.splice(result.findIndex(section => section.id === 'tracker') + 1, 0, { id, enabled: true });
  } else {
   result.push({ id, enabled: true });
  }
 }
 return result;
}

export function isStatusDockSectionEnabled(value: unknown, id: StatusDockSectionId): boolean {
 return normalizeStatusDockSections(value).find(section => section.id === id)?.enabled === true;
}
