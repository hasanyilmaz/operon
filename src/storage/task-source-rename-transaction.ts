import { renameCanonicalTableFileWithAcknowledgement } from './table-file-rename-acknowledgement';

/** A rename is a separate filesystem operation. Never report a partial/unknown result as an untouched source. */
export class TaskSourceRenameUncertainError extends Error {
 constructor() { super('Task filename transaction requires source reconciliation'); }
}
export interface TaskSourceRenamePorts {
 previousPath: string;
 candidatePath: string;
 currentPath(): string;
 owns(path: string): boolean;
 occupied(path: string): boolean;
 read(): Promise<string>;
 rename(path: string): Promise<void>;
 canCommit(): boolean;
 validate(content: string): boolean;
 validateCommitted(content: string): boolean;
 /** Prepare domain consequences first; invoke ensureRenamed immediately before the source commit. */
 commit(ensureRenamed: () => Promise<boolean>): Promise<boolean>;
}
export async function executeTaskSourceRenameTransaction(ports: TaskSourceRenamePorts): Promise<boolean> {
 const { previousPath, candidatePath } = ports;
 if (previousPath === candidatePath || !ports.canCommit() || ports.currentPath() !== previousPath
  || !ports.owns(previousPath) || ports.occupied(candidatePath)) return false;
 const before = await ports.read();
 if (!ports.validate(before)) return false;
 let renamed = false;
 try {
 const ensureRenamed = async () => {
  if (renamed) return ports.currentPath() === candidatePath && ports.owns(candidatePath) && ports.canCommit();
  if (!ports.canCommit() || ports.currentPath() !== previousPath || !ports.owns(previousPath)
   || ports.occupied(candidatePath) || await ports.read() !== before) return false;
  const ack = await renameCanonicalTableFileWithAcknowledgement({previousPath, candidatePath,
   renameCandidate: () => ports.rename(candidatePath), getCurrentPath: () => ports.currentPath()});
  if (ack.status === 'previous') return false;
  if (ack.status !== 'candidate') throw new TaskSourceRenameUncertainError();
  renamed = true;
  if (!ports.owns(candidatePath) || await ports.read() !== before) throw new TaskSourceRenameUncertainError();
  return true;
 };
 let committed = false;
 try { committed = await ports.commit(ensureRenamed); }
 catch (error) {
  if (error instanceof TaskSourceRenameUncertainError) throw error;
  if (!renamed) throw error;
  // Only exact preimages are eligible for compensating rename, never overwrite later edits.
 }
 if (committed) {
  if (!renamed || ports.currentPath() !== candidatePath || !ports.owns(candidatePath)
   || !ports.validateCommitted(await ports.read())) throw new TaskSourceRenameUncertainError();
  return true;
 }
 if (!renamed) return false;
 if (ports.currentPath() !== candidatePath || !ports.owns(candidatePath)
  || ports.occupied(previousPath) || await ports.read() !== before) throw new TaskSourceRenameUncertainError();
 const rollback = await renameCanonicalTableFileWithAcknowledgement({previousPath:candidatePath,candidatePath:previousPath,
  renameCandidate:()=>ports.rename(previousPath),getCurrentPath:()=>ports.currentPath()});
 if (rollback.status !== 'candidate' || !ports.owns(previousPath) || await ports.read() !== before)
  throw new TaskSourceRenameUncertainError();
 return false;
 } catch (error) {
  if (renamed || ports.currentPath() !== previousPath) throw new TaskSourceRenameUncertainError();
  throw error;
 }
}
