#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { formatIssue, parseTrace } from './parse.ts';
import { computeStats } from './stats.ts';
import { renderStats, renderTimeline } from './render.ts';

const VERSION = '0.1.0';

const USAGE = `agent-trace -- inspect an agent JSONL trace

Usage:
  agent-trace stats <file> [--json] [--strict]
  agent-trace show <file> [--tool=<name>] [--max-arg=<n>] [--no-text] [--strict]

  <file> may be "-" to read the trace from stdin.

Options:
  --json          print stats as JSON instead of a table (stats only)
  --tool=<name>   restrict show to a single tool
  --max-arg=<n>   truncate tool arguments to n characters (default 80)
  --no-text       hide user and assistant messages (show only)
  --strict        exit 1 if any line failed to parse
  -h, --help      show this help
  --version       show the version number

Exit codes: 0 success, 1 nothing usable in the trace (or --strict with bad
lines), 2 bad usage.`;

class UsageError extends Error {}

interface CliOptions {
  json: boolean;
  tool: string | undefined;
  maxArgLength: number | undefined;
  showText: boolean;
  strict: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: readonly string[]): { options: CliOptions; positionals: string[] } {
  const options: CliOptions = {
    json: false,
    tool: undefined,
    maxArgLength: undefined,
    showText: true,
    strict: false,
    help: false,
    version: false,
  };
  const positionals: string[] = [];

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--version') {
      options.version = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--no-text') {
      options.showText = false;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg.startsWith('--tool=')) {
      options.tool = arg.slice('--tool='.length);
    } else if (arg.startsWith('--max-arg=')) {
      const raw = arg.slice('--max-arg='.length);
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`invalid --max-arg value: ${raw}`);
      options.maxArgLength = Math.trunc(n);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  return { options, positionals };
}

function readTrace(file: string): string {
  return file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
}

function main(argv: readonly string[]): number {
  let parsed: { options: CliOptions; positionals: string[] };
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}\n`);
    return 2;
  }

  const { options, positionals } = parsed;

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const [command, file] = positionals;
  if (command !== 'stats' && command !== 'show') {
    process.stderr.write(`unknown command "${command ?? ''}"\n\n${USAGE}\n`);
    return 2;
  }
  if (!file) {
    process.stderr.write(`missing <file> argument\n\n${USAGE}\n`);
    return 2;
  }

  let text: string;
  try {
    text = readTrace(file);
  } catch (err) {
    process.stderr.write(`cannot read ${file === '-' ? 'stdin' : file}: ${(err as Error).message}\n`);
    return 2;
  }

  const { events, issues } = parseTrace(text);
  for (const issue of issues) process.stderr.write(`${formatIssue(issue)}\n`);

  if (events.length === 0) {
    process.stderr.write('no usable events found in trace\n');
    return 1;
  }

  if (command === 'stats') {
    const stats = computeStats(events);
    process.stdout.write(options.json ? `${JSON.stringify(stats, null, 2)}\n` : `${renderStats(stats)}\n`);
  } else {
    const timeline = renderTimeline(events, {
      tool: options.tool,
      maxArgLength: options.maxArgLength,
      showText: options.showText,
    });
    if (timeline.length > 0) process.stdout.write(`${timeline}\n`);
  }

  return options.strict && issues.length > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
