import {
	OPERON_CLI_COMMAND_DEFINITIONS_V1,
	type OperonCliCommandDefinitionV1,
	commandOptionRequiresValueV1,
} from './command-registry';

export type OperonShellCompletionV1 = 'zsh' | 'bash' | 'fish';

interface CompletionPathV1 {
	key: string;
	tokens: readonly string[];
	options: readonly string[];
	positionalValues: readonly string[];
	optionValues: Readonly<Record<string, readonly string[]>>;
}

const SAFE_TOKEN = /^[a-z0-9][a-z0-9.-]*$/u;
const SAFE_OPTION = /^--[a-z][a-z0-9-]*$/u;
const COMMAND_DEFINITIONS: readonly OperonCliCommandDefinitionV1[] =
	OPERON_CLI_COMMAND_DEFINITIONS_V1;

export function renderShellCompletionV1(shell: OperonShellCompletionV1): string {
	const paths = completionPathsV1();
	switch (shell) {
		case 'zsh':
			return renderZshCompletion(paths);
		case 'bash':
			return renderBashCompletion(paths);
		case 'fish':
			return renderFishCompletion(paths);
	}
}

function completionPathsV1(): CompletionPathV1[] {
	const paths: CompletionPathV1[] = [];
	for (const definition of COMMAND_DEFINITIONS) {
		const definitionPaths: readonly (readonly string[])[] = [
			definition.path,
			...(definition.aliases ?? []),
		];
		for (const tokens of definitionPaths) {
			assertSafePath(tokens);
			paths.push({
				key: tokens.join(' '),
				tokens,
				options: completionOptions(definition),
				positionalValues: completionPositionalValues(definition),
				optionValues: completionOptionValues(definition),
			});
		}
	}
	return paths.sort((left, right) => left.key.localeCompare(right.key));
}

function completionPositionalValues(
	definition: OperonCliCommandDefinitionV1,
): readonly string[] {
	const values = [...(definition.completion?.positionalValues ?? [])].sort();
	if (values.some(value => !SAFE_TOKEN.test(value))) {
		throw new Error('OPERON_COMPLETION_UNSAFE_POSITIONAL');
	}
	return values;
}

function completionOptionValues(
	definition: OperonCliCommandDefinitionV1,
): Readonly<Record<string, readonly string[]>> {
	const result: Record<string, readonly string[]> = {};
	for (const [option, sourceValues] of Object.entries(
		definition.completion?.optionValues ?? {},
	)) {
		if (!SAFE_OPTION.test(option)) {
			throw new Error('OPERON_COMPLETION_UNSAFE_OPTION');
		}
		const values = [...sourceValues].sort();
		if (values.some(value => !SAFE_TOKEN.test(value))) {
			throw new Error('OPERON_COMPLETION_UNSAFE_OPTION_VALUE');
		}
		result[option] = values;
	}
	return result;
}

function completionOptions(definition: OperonCliCommandDefinitionV1): string[] {
	const options = (definition.options ?? [])
		.map(option => option.trim().split(/\s+/u, 1)[0] ?? '')
		.filter(name => name.startsWith('-'))
		.map(name => {
			if (!SAFE_OPTION.test(name)) throw new Error('OPERON_COMPLETION_UNSAFE_OPTION');
			return name;
		});
	const unique = [...new Set([...options, '--help'])].sort();
	for (const option of unique) {
		if (!SAFE_OPTION.test(option)) throw new Error('OPERON_COMPLETION_UNSAFE_OPTION');
	}
	return unique;
}

function assertSafePath(tokens: readonly string[]): void {
	if (tokens.length === 0 || tokens.some(token => !SAFE_TOKEN.test(token))) {
		throw new Error('OPERON_COMPLETION_UNSAFE_COMMAND');
	}
}

function firstTokens(paths: readonly CompletionPathV1[]): string[] {
	return [...new Set(paths.map(path => path.tokens[0]))].sort();
}

function groupSubcommands(paths: readonly CompletionPathV1[]): ReadonlyMap<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const path of paths) {
		for (let length = 1; length < path.tokens.length; length++) {
			const key = path.tokens.slice(0, length).join(' ');
			const values = groups.get(key) ?? [];
			const next = path.tokens[length];
			if (next && !values.includes(next)) values.push(next);
			groups.set(key, values);
		}
	}
	for (const values of groups.values()) values.sort();
	return groups;
}

function renderBashCompletion(paths: readonly CompletionPathV1[]): string {
	const first = firstTokens(paths).join(' ');
	const groups = groupSubcommands(paths);
	const firstLevelGroups = [...groups.entries()].filter(([group]) => !group.includes(' '));
	const nestedGroups = [...groups.entries()].filter(([group]) => group.includes(' '));
	const optionCases = paths.map(path => (
		`    ${shellCasePattern(path.key)}) options=${shellSingleQuote(path.options.join(' '))} ;;`
	));
	const positionalCases = paths
		.filter(path => path.positionalValues.length > 0)
		.map(path => (
			`    ${shellCasePattern(path.key)}) candidates=${shellSingleQuote(path.positionalValues.join(' '))}; positional_index=${path.tokens.length + 1} ;;`
		));
	const optionValueCases = paths.flatMap(path => (
		Object.entries(path.optionValues).map(([option, values]) => (
			`    ${shellCasePattern(`${path.key} ${option}`)}) candidates=${shellSingleQuote(values.join(' '))} ;;`
		))
	));
	const groupedFirstTokens = firstLevelGroups.map(([group]) => group).sort().join('|');
	const groupCases = firstLevelGroups.sort(([left], [right]) => left.localeCompare(right))
		.map(([group, commands]) => (
			`      ${group}) candidates=${shellSingleQuote(commands.join(' '))} ;;`
		));
	const nestedGroupCases = nestedGroups.sort(([left], [right]) => left.localeCompare(right))
		.map(([group, commands]) => (
			`      ${shellCasePattern(group)}) candidates=${shellSingleQuote(commands.join(' '))} ;;`
		));
	return [
		'# Operon CLI completion for bash. Generated from the installed command registry.',
		'_operon_completion() {',
		'  local current previous key option_key options candidates positional_index candidate',
		'  current="${COMP_WORDS[COMP_CWORD]}"',
		'  previous="${COMP_WORDS[COMP_CWORD-1]}"',
		'  key="${COMP_WORDS[1]}"',
		`  if (( COMP_CWORD >= 3 )); then case "\${COMP_WORDS[1]}" in ${groupedFirstTokens}) key+=" \${COMP_WORDS[2]}" ;; esac; fi`,
		'  if (( COMP_CWORD >= 4 )); then',
		'    case "${COMP_WORDS[1]} ${COMP_WORDS[2]}" in',
		...nestedGroups.map(([group]) => `      ${shellCasePattern(group)}) key+=" \${COMP_WORDS[3]}" ;;`),
		'    esac',
		'  fi',
		'  if [[ "$previous" == "--input" ]]; then',
		'    COMPREPLY=()',
		'    while IFS= read -r candidate; do COMPREPLY+=("$candidate"); done < <(compgen -f -- "$current")',
		'    compopt -o filenames 2>/dev/null || true',
		'    return',
		'  fi',
		'  if [[ "$previous" == "--vault" ]]; then',
		'    COMPREPLY=()',
		'    while IFS= read -r candidate; do COMPREPLY+=("$candidate"); done < <(compgen -d -- "$current")',
		'    compopt -o filenames 2>/dev/null || true',
		'    return',
		'  fi',
		'  option_key="$key $previous"',
		'  candidates=""',
		'  case "$option_key" in',
		...optionValueCases,
		'  esac',
		'  if [[ -n "$candidates" ]]; then',
		'    COMPREPLY=( $(compgen -W "$candidates" -- "$current") )',
		'    return',
		'  fi',
		'  if (( COMP_CWORD == 1 )); then',
		`    COMPREPLY=( $(compgen -W ${shellSingleQuote(first)} -- "$current") )`,
		'    return',
		'  fi',
		'  if (( COMP_CWORD == 2 )); then',
		'    candidates=""',
		'    case "${COMP_WORDS[1]}" in',
		...groupCases,
		'    esac',
		'    if [[ -n "$candidates" ]]; then',
		'      COMPREPLY=( $(compgen -W "$candidates" -- "$current") )',
		'      return',
		'    fi',
		'  fi',
		'  if (( COMP_CWORD == 3 )); then',
		'    candidates=""',
		'    case "${COMP_WORDS[1]} ${COMP_WORDS[2]}" in',
		...nestedGroupCases,
		'    esac',
		'    if [[ -n "$candidates" ]]; then',
		'      COMPREPLY=( $(compgen -W "$candidates" -- "$current") )',
		'      return',
		'    fi',
		'  fi',
		'  candidates=""',
		'  positional_index=-1',
		'  case "$key" in',
		...positionalCases,
		'  esac',
		'  if [[ -n "$candidates" && "$current" != -* ]] && (( COMP_CWORD == positional_index )); then',
		'    COMPREPLY=( $(compgen -W "$candidates" -- "$current") )',
		'    return',
		'  fi',
		'  options=""',
		'  case "$key" in',
		...optionCases,
		'  esac',
		'  COMPREPLY=( $(compgen -W "$options" -- "$current") )',
		'}',
		'complete -F _operon_completion operon',
	].join('\n');
}

function renderZshCompletion(paths: readonly CompletionPathV1[]): string {
	const first = firstTokens(paths).join(' ');
	const groups = groupSubcommands(paths);
	const firstLevelGroups = [...groups.entries()].filter(([group]) => !group.includes(' '));
	const nestedGroups = [...groups.entries()].filter(([group]) => group.includes(' '));
	const optionCases = paths.map(path => (
		`    ${shellCasePattern(path.key)}) candidates=(${path.options.map(shellSingleQuote).join(' ')}) ;;`
	));
	const positionalCases = paths
		.filter(path => path.positionalValues.length > 0)
		.map(path => (
			`    ${shellCasePattern(path.key)}) candidates=(${path.positionalValues.map(shellSingleQuote).join(' ')}); positional_index=${path.tokens.length + 2} ;;`
		));
	const optionValueCases = paths.flatMap(path => (
		Object.entries(path.optionValues).map(([option, values]) => (
			`    ${shellCasePattern(`${path.key} ${option}`)}) candidates=(${values.map(shellSingleQuote).join(' ')}) ;;`
		))
	));
	const groupedFirstTokens = firstLevelGroups.map(([group]) => group).sort().join('|');
	const groupCases = firstLevelGroups.sort(([left], [right]) => left.localeCompare(right))
		.map(([group, commands]) => (
			`      ${group}) candidates=(${commands.map(shellSingleQuote).join(' ')}) ;;`
		));
	const nestedGroupCases = nestedGroups.sort(([left], [right]) => left.localeCompare(right))
		.map(([group, commands]) => (
			`      ${shellCasePattern(group)}) candidates=(${commands.map(shellSingleQuote).join(' ')}) ;;`
		));
	return [
		'#compdef operon',
		'# Operon CLI completion for zsh. Generated from the installed command registry.',
		'if (( ! $+functions[compdef] )); then',
		'  autoload -Uz compinit && compinit -i',
		'fi',
		'_operon_completion() {',
		'  local key option_key positional_index',
		'  local -a candidates',
		'  key="${words[2]}"',
		`  if (( CURRENT >= 4 )); then case "\${words[2]}" in ${groupedFirstTokens}) key+=" \${words[3]}" ;; esac; fi`,
		'  if (( CURRENT >= 5 )); then',
		'    case "${words[2]} ${words[3]}" in',
		...nestedGroups.map(([group]) => `      ${shellCasePattern(group)}) key+=" \${words[4]}" ;;`),
		'    esac',
		'  fi',
		'  if (( CURRENT > 2 )) && [[ "${words[CURRENT-1]}" == "--input" ]]; then',
		'    _files',
		'    return',
		'  fi',
		'  if (( CURRENT > 2 )) && [[ "${words[CURRENT-1]}" == "--vault" ]]; then',
		'    _files -/',
		'    return',
		'  fi',
		'  if (( CURRENT > 2 )); then',
		'    option_key="$key ${words[CURRENT-1]}"',
		'    candidates=()',
		'    case "$option_key" in',
		...optionValueCases,
		'    esac',
		'  fi',
		'  if (( ${#candidates} > 0 )); then',
		"    _describe 'value' candidates",
		'    return',
		'  fi',
		'  if (( CURRENT == 2 )); then',
		`    candidates=(${first.split(' ').map(shellSingleQuote).join(' ')})`,
		"    _describe 'command' candidates",
		'    return',
		'  fi',
		'  if (( CURRENT == 3 )); then',
		'    candidates=()',
		'    case "${words[2]}" in',
		...groupCases,
		'    esac',
		'    if (( ${#candidates} > 0 )); then',
		"      _describe 'subcommand' candidates",
		'      return',
		'    fi',
		'  fi',
		'  if (( CURRENT == 4 )); then',
		'    candidates=()',
		'    case "${words[2]} ${words[3]}" in',
		...nestedGroupCases,
		'    esac',
		'    if (( ${#candidates} > 0 )); then',
		"      _describe 'subcommand' candidates",
		'      return',
		'    fi',
		'  fi',
		'  candidates=()',
		'  positional_index=-1',
		'  case "$key" in',
		...positionalCases,
		'  esac',
		'  if (( ${#candidates} > 0 && CURRENT == positional_index )) && [[ "${words[CURRENT]}" != -* ]]; then',
		"    _describe 'value' candidates",
		'    return',
		'  fi',
		'  candidates=()',
		'  case "$key" in',
		...optionCases,
		'  esac',
		"  _describe 'option' candidates",
		'}',
		'compdef _operon_completion operon',
	].join('\n');
}

function renderFishCompletion(paths: readonly CompletionPathV1[]): string {
	const groups = groupSubcommands(paths);
	const lines = [
		'# Operon CLI completion for fish. Generated from the installed command registry.',
		'function __operon_using_command',
		'    set -l tokens (commandline -opc)',
		'    if test (count $tokens) -gt 0',
		'        set -e tokens[1]',
		'    end',
		'    if test (count $tokens) -lt (count $argv)',
		'        return 1',
		'    end',
		'    for index in (seq (count $argv))',
		'        if test "$tokens[$index]" != "$argv[$index]"',
		'            return 1',
		'        end',
		'    end',
		'    return 0',
		'end',
		'function __operon_at_command',
		'    set -l tokens (commandline -opc)',
		'    if test (count $tokens) -gt 0',
		'        set -e tokens[1]',
		'    end',
		'    if test (count $tokens) -ne (count $argv)',
		'        return 1',
		'    end',
		'    for index in (seq (count $argv))',
		'        if test "$tokens[$index]" != "$argv[$index]"',
		'            return 1',
		'        end',
		'    end',
		'    return 0',
		'end',
		'complete -c operon -e',
	];
	for (const token of firstTokens(paths)) {
		lines.push(`complete -c operon -f -n '__fish_use_subcommand' -a ${shellSingleQuote(token)}`);
	}
	for (const [group, commands] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		for (const command of commands) {
			lines.push(
				`complete -c operon -f -n '__operon_at_command ${group}' -a ${shellSingleQuote(command)}`,
			);
		}
	}
	for (const path of paths) {
		const definition = definitionForPath(path.tokens);
		for (const value of path.positionalValues) {
			lines.push(
				`complete -c operon -f -n '__operon_at_command ${path.key}' -a ${shellSingleQuote(value)}`,
			);
		}
		for (const option of path.options) {
			const name = option.slice(2);
			const requiresValue = commandOptionRequiresValueV1(definition, option);
			const staticValues = path.optionValues[option];
			const fileMode = option === '--input'
				? ' -r'
				: option === '--vault'
					? " -r -a '(__fish_complete_directories)'"
					: staticValues
						? ` -r -f -a ${shellSingleQuote(staticValues.join(' '))}`
					: requiresValue
						? ' -r -f'
						: ' -f';
			lines.push(
				`complete -c operon -n '__operon_using_command ${path.key}' -l ${name}${fileMode}`,
			);
		}
	}
	return lines.join('\n');
}

function definitionForPath(tokens: readonly string[]): OperonCliCommandDefinitionV1 {
	const match = COMMAND_DEFINITIONS.find(definition => {
		const definitionPaths: readonly (readonly string[])[] = [
			definition.path,
			...(definition.aliases ?? []),
		];
		return definitionPaths.some(path => (
			path.length === tokens.length && path.every((token, index) => token === tokens[index])
		));
	});
	if (!match) throw new Error('OPERON_COMPLETION_COMMAND_MISSING');
	return match;
}

function shellCasePattern(value: string): string {
	const tokens = value.split(' ');
	if (tokens.some(token => !SAFE_TOKEN.test(token) && !SAFE_OPTION.test(token))) {
		throw new Error('OPERON_COMPLETION_UNSAFE_COMMAND');
	}
	return tokens.join('\\ ');
}

function shellSingleQuote(value: string): string {
	return `'${value.split("'").join("'\\''")}'`;
}
