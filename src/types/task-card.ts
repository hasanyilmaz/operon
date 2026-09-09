import type { KanbanTaskColorSource } from '../core/task-color-source';
import type { KanbanCardImageSource } from './kanban';

export type TaskCardSection = 'image' | 'header' | 'taskProgress' | 'chips' | 'checkboxProgress';
export interface TaskCardSettings {
 canvasTaskPoolWidth: number;
 canvasTaskPoolRows: number;
 /** Legacy compatibility only; panel pin state now controls closing. */
 canvasTaskPoolKeepOpen: boolean;
 taskCardShowTaskProgress: boolean;
 taskCardShowChips: boolean;
 taskCardShowCheckboxProgress: boolean;
 taskCardWidth: number;
 taskCardAlign: 'left' | 'center' | 'right';
 taskCardWrap: boolean;
 taskCardColorSource: KanbanTaskColorSource;
 taskCardImageSource: KanbanCardImageSource;
 taskCardImageRatio: 'original' | 'landscape' | 'square' | 'portrait';
 taskCardItemOrder: TaskCardSection[];
}
export const TASK_CARD_WIDTHS: readonly number[] = [300, 325, 350, 375, 400];
export const DEFAULT_TASK_CARD_SETTINGS: TaskCardSettings = {
 canvasTaskPoolWidth: 320, canvasTaskPoolRows: 7, canvasTaskPoolKeepOpen: true,
 taskCardShowTaskProgress: true, taskCardShowChips: true, taskCardShowCheckboxProgress: true,
 taskCardWidth: 350, taskCardAlign: 'left', taskCardWrap: false,
 taskCardColorSource: 'taskColor', taskCardImageSource: 'taskImage',
 taskCardImageRatio: 'original', taskCardItemOrder: ['image', 'header', 'taskProgress', 'chips', 'checkboxProgress'],
};
export const TASK_CARD_SETTING_KEYS = Object.keys(DEFAULT_TASK_CARD_SETTINGS) as (keyof TaskCardSettings)[];
export function isTaskCardSetting(key: string): key is keyof TaskCardSettings {
 return TASK_CARD_SETTING_KEYS.includes(key as keyof TaskCardSettings);
}
export function normalizeTaskCardSettings(source: Partial<Record<keyof TaskCardSettings, unknown>>): TaskCardSettings {
 const defaults = DEFAULT_TASK_CARD_SETTINGS;
 const select = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T =>
  typeof value === 'string' && choices.includes(value as T) ? value as T : fallback;
 const align = select(source.taskCardAlign, ['left', 'center', 'right'], defaults.taskCardAlign);
 const order = Array.isArray(source.taskCardItemOrder) ? source.taskCardItemOrder : [];
 return {
  canvasTaskPoolWidth: [240, 280, 320, 360, 400].includes(source.canvasTaskPoolWidth as number) ? source.canvasTaskPoolWidth as number : 320,
  canvasTaskPoolRows: [5, 7, 11, 13].includes(source.canvasTaskPoolRows as number) ? source.canvasTaskPoolRows as number : 7,
  canvasTaskPoolKeepOpen: typeof source.canvasTaskPoolKeepOpen === 'boolean' ? source.canvasTaskPoolKeepOpen : true,
  taskCardShowTaskProgress: typeof source.taskCardShowTaskProgress === 'boolean' ? source.taskCardShowTaskProgress : true,
  taskCardShowChips: typeof source.taskCardShowChips === 'boolean' ? source.taskCardShowChips : true,
  taskCardShowCheckboxProgress: typeof source.taskCardShowCheckboxProgress === 'boolean' ? source.taskCardShowCheckboxProgress : true,
  taskCardWidth: TASK_CARD_WIDTHS.includes(source.taskCardWidth as number) ? source.taskCardWidth as number : defaults.taskCardWidth,
  taskCardAlign: align, taskCardWrap: align !== 'center' && source.taskCardWrap === true,
  taskCardColorSource: select(source.taskCardColorSource, ['noColor', 'taskColor', 'statusColor', 'priorityColor'], defaults.taskCardColorSource),
  taskCardImageSource: select(source.taskCardImageSource, ['none', 'taskImage', 'taskGalleryFirst', 'taskGalleryLast'], defaults.taskCardImageSource),
  taskCardImageRatio: select(source.taskCardImageRatio, ['original', 'landscape', 'square', 'portrait'], defaults.taskCardImageRatio),
  taskCardItemOrder: [...new Set([...order.filter((value): value is TaskCardSection => defaults.taskCardItemOrder.includes(value as TaskCardSection)), ...defaults.taskCardItemOrder])],
 };
}
