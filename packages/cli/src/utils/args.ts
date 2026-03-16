export interface ParsedArgs {
  command: string;
  subcommand: string;
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const command = args[0] || '';
  const subcommand = args[1] || '';
  const flags: Record<string, string> = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[++i];
    }
  }
  return { command, subcommand, flags };
}
