export interface RuntimeTaskSourceWriteReindexPortsV1<File> {
	reindexKnownFile(file: File, committedContent: string): Promise<void>;
	reindexFilePath(filePath: string): Promise<void>;
	removeFilePath(filePath: string): Promise<void>;
}

/** Reindexes one committed task-source write before a dependent graph step can run. */
export async function reindexCommittedRuntimeTaskSourceWriteV1<File>(
	write: { readonly file?: File; readonly committedContent?: string; readonly deleted?: boolean },
	filePath: string,
	ports: RuntimeTaskSourceWriteReindexPortsV1<File>,
): Promise<'known-file' | 'file-path' | 'removed'> {
	if (write.deleted === true) {
		await ports.removeFilePath(filePath);
		return 'removed';
	}
	if (write.file !== undefined && write.committedContent !== undefined) {
		await ports.reindexKnownFile(write.file, write.committedContent);
		return 'known-file';
	}
	await ports.reindexFilePath(filePath);
	return 'file-path';
}
