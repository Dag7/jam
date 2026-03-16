import { parseArgs } from './utils/args.js';
import { svcRegister, svcDeregister, svcList, svcCheck } from './commands/svc.js';
import { cronAdd, cronRemove, cronList, cronSetEnabled } from './commands/cron.js';

function printUsage(): void {
  console.log(`jam — Agent service & cron management

Usage:
  jam svc register  --name <n> --port <p> --command <cmd> [--health <path>] [--log <file>]
  jam svc deregister --name <n>
  jam svc list
  jam svc check     [--name <n> | --port <p>]

  jam cron add      --name <n> --schedule "<cron>" --command <cmd>
  jam cron remove   --name <n>
  jam cron list
  jam cron enable   --name <n>
  jam cron disable  --name <n>

Options:
  --cwd <dir>     Working directory (defaults to current dir)
  --health <path> HTTP healthcheck path (e.g. /healthz)
  --log <file>    Log file path (relative to cwd)

Examples:
  jam svc register --name api --port 3010 --command "node server.js" --health /healthz
  jam cron add --name cleanup --schedule "0 2 * * *" --command "node cleanup.js"
  jam cron disable --name cleanup`);
}

const parsed = parseArgs(process.argv);

switch (parsed.command) {
  case 'svc':
    switch (parsed.subcommand) {
      case 'register': svcRegister(parsed.flags); break;
      case 'deregister': svcDeregister(parsed.flags); break;
      case 'list': svcList(parsed.flags); break;
      case 'check': svcCheck(parsed.flags); break;
      default: console.error('Unknown svc command: ' + parsed.subcommand); printUsage(); process.exit(1);
    }
    break;
  case 'cron':
    switch (parsed.subcommand) {
      case 'add': cronAdd(parsed.flags); break;
      case 'remove': cronRemove(parsed.flags); break;
      case 'list': cronList(parsed.flags); break;
      case 'enable': cronSetEnabled(parsed.flags, true); break;
      case 'disable': cronSetEnabled(parsed.flags, false); break;
      default: console.error('Unknown cron command: ' + parsed.subcommand); printUsage(); process.exit(1);
    }
    break;
  default: printUsage(); process.exit(parsed.command ? 1 : 0);
}
