export declare const CAPABILITY_IDS_V1: readonly ["system.health", "system.capabilities", "system.diagnostics", "catalog.read", "entities.resolve", "tasks.read", "tasks.query", "tasks.finder", "relationships.read", "context.build", "tasks.create.preview", "tasks.create.apply", "tasks.update.preview", "tasks.update.apply", "tasks.recurrence.preview", "tasks.recurrence.apply", "tasks.relationship.preview", "tasks.relationship.apply", "tasks.reminder.preview", "tasks.reminder.apply", "tasks.transition.preview", "tasks.transition.apply", "tasks.pinned.preview", "tasks.pinned.apply", "timers.read", "timers.control.preview", "timers.control.apply", "timers.session.preview", "timers.session.apply", "tasks.convert.preview", "tasks.convert.apply", "tasks.inline.relocate.preview", "tasks.inline.relocate.apply", "tasks.delete.preview", "tasks.delete.apply"];
export type CapabilityIdV1 = typeof CAPABILITY_IDS_V1[number];
export type CapabilityModeV1 = 'read' | 'preview' | 'apply';
export type CapabilityAvailabilityV1 = 'contract-only' | 'available' | 'degraded' | 'unavailable';
export declare const MUTATION_KINDS_V1: readonly ["task.create", "task.update", "task.recurrence", "task.relationship", "task.reminder-item", "task.transition", "task.pinned-state", "timer.control", "timer.session", "task.convert", "task.inline-relocate", "task.delete"];
export type MutationKindV1 = typeof MUTATION_KINDS_V1[number];
export interface CapabilityDefinitionV1 {
    readonly id: CapabilityIdV1;
    readonly mode: CapabilityModeV1;
    readonly mutationKind?: MutationKindV1;
    readonly destructive: boolean;
}
export interface CapabilityAdvertisementV1 {
    /** Additive wire identifier; use isCapabilityIdV1 before treating it as known authority. */
    readonly id: string;
    readonly availability: CapabilityAvailabilityV1;
    readonly stability: 'stable';
    readonly reason?: string;
    readonly deprecation?: {
        readonly announcedIn: string;
        readonly removal: 'runtime-v2';
        readonly replacement?: string;
    };
}
export declare const CAPABILITY_REGISTRY_V1: readonly CapabilityDefinitionV1[];
declare const mutationCapabilityMap: Record<MutationKindV1, {
    preview: CapabilityIdV1;
    apply: CapabilityIdV1;
}>;
export declare const MUTATION_CAPABILITY_MAP_V1: Readonly<typeof mutationCapabilityMap>;
export declare function isCapabilityIdV1(value: string): value is CapabilityIdV1;
export declare function isMutationKindV1(value: string): value is MutationKindV1;
export {};
