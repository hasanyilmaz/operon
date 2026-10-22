/** Independent desktop profiles, including types that currently share a frame. */
export const LIGHTBOX_SIZE_PROFILES = ['markdown', 'base', 'table', 'web', 'pdf', 'image', 'video', 'youtube'] as const;
export type LightboxSizeProfile = typeof LIGHTBOX_SIZE_PROFILES[number];
export type LightboxSizeAxis = 'width' | 'height';
export const LIGHTBOX_SIZE_STEPS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90] as const;
export type LightboxSizes = Partial<Record<LightboxSizeProfile, Partial<Record<LightboxSizeAxis, number>>>>;

export function normalizeLightboxSizes(value: unknown): LightboxSizes {
 const sizes: LightboxSizes = {};
 if (!value || typeof value !== 'object' || Array.isArray(value)) return sizes;
 for (const profile of LIGHTBOX_SIZE_PROFILES) {
  if (!Object.prototype.hasOwnProperty.call(value, profile)) continue;
  const entry = (value as Record<string, unknown>)[profile];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
  for (const axis of ['width', 'height'] as const) {
   const size = (entry as Record<string, unknown>)[axis];
   if (Object.prototype.hasOwnProperty.call(entry, axis) && typeof size === 'number' && LIGHTBOX_SIZE_STEPS.some(step => step === size)) {
    (sizes[profile] ??= {})[axis] = size;
   }
  }
 }
 return sizes;
}

interface LightboxSizePreference {
 controlsSide?: () => 'left' | 'right';
 get: () => LightboxSizes;
 save: (profile: LightboxSizeProfile, axis: LightboxSizeAxis, value: number) => Promise<void>;
}
let preference: LightboxSizePreference | null = null;
export function bindLightboxSizePreference(binding: LightboxSizePreference): () => void {
 preference = binding;
 return () => { if (preference === binding) preference = null; };
}
/** Snapshot this when a lightbox opens; preference reads never save settings. */
export function getLightboxControlSide(): 'left' | 'right' {
 return preference?.controlsSide?.() === 'left' ? 'left' : 'right';
}
export function getLightboxProfileSize(profile: LightboxSizeProfile): LightboxSizes[LightboxSizeProfile] {
 return normalizeLightboxSizes(preference?.get())[profile];
}
/** Only explicit control clicks call this; loading and viewport changes never write. */
export async function saveLightboxProfileSize(profile: LightboxSizeProfile, axis: LightboxSizeAxis, value: number): Promise<void> {
 await preference?.save(profile, axis, value);
}
