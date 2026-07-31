export interface InteractiveTerminalPortV1 {
	ask(prompt: string): Promise<string | null>;
	write(text: string): void;
}
