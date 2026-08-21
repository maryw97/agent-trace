import { pairToolEvents } from './pair.ts';
import type { ToolSpan } from './pair.ts';
import type { TraceEvent } from './types.ts';
import type { ToolStats, TraceStats } from './stats.ts';

export interface TimelineOptions {
  /** Only show tool_call/tool_result events for this tool; hides narration too. */
  tool?: string;
  /** Truncate tool call arguments and result output/error to this many characters. Default 80. */
  maxArgLength?: number;
  /** Include user and assistant text lines. Default true. */
  showText?: boolean;
}

const DEFAULT_MAX_ARG_LENGTH = 80;
/** Width of the widest event-type label ("tool_result"), so columns line up. */
const TYPE_LABEL_WIDTH = 11;

/**
 * Render a trace as an indented, chronological timeline. Pure function over
 * the parsed events -- callers that build events by hand get the same output
 * as callers reading a real trace file.
 */
export function renderTimeline(events: readonly TraceEvent[], options: TimelineOptions = {}): string {
  const maxArgLength = options.maxArgLength ?? DEFAULT_MAX_ARG_LENGTH;
  const showText = options.showText ?? true;
  const toolFilter = options.tool;

  const { spans } = pairToolEvents(events);
  const spanByResultIndex = new Map<number, ToolSpan>();
  for (const span of spans) {
    if (span.resultIndex !== null) spanByResultIndex.set(span.resultIndex, span);
  }

  const firstTs = events.find((event) => event.ts !== null)?.ts ?? null;
  const lines: string[] = [];

  events.forEach((event, index) => {
    if (event.type === 'user' || event.type === 'assistant') {
      if (!showText || toolFilter) return;
      const offset = formatOffset(event.ts, firstTs);
      const detail =
        event.type === 'assistant' && event.usage
          ? `${event.text}  [${event.usage.input} in / ${event.usage.output} out]`
          : event.text;
      lines.push(`${offset} ${pad(event.type)} ${truncate(detail, maxArgLength)}`);
      return;
    }

    if (event.type === 'tool_call') {
      if (toolFilter && event.name !== toolFilter) return;
      const offset = formatOffset(event.ts, firstTs);
      lines.push(`${offset} ${pad('tool_call')} ${event.name}  ${truncate(safeStringify(event.args), maxArgLength)}`);
      return;
    }

    // tool_result
    const span = spanByResultIndex.get(index);
    const name = span?.call.name ?? null;
    if (toolFilter && name !== toolFilter) return;
    const offset = formatOffset(event.ts, firstTs);
    const label = name ?? '<orphan>';
    const status = event.ok ? 'ok' : 'FAILED';
    const duration = formatDuration(span?.durationMs ?? event.durationMs);
    const detail = event.ok ? event.output : event.error ?? event.output;
    lines.push(`${offset} ${pad('tool_result')} ${label}  ${status}  ${duration}  ${truncate(detail, maxArgLength)}`);
  });

  return lines.join('\n');
}

/** Render the summary block produced by `computeStats`, e.g. for the `stats` CLI command. */
export function renderStats(stats: TraceStats): string {
  const lines: string[] = [];
  const { byType } = stats;

  lines.push(
    `${label('events')}${stats.events}  (user ${byType.user}, assistant ${byType.assistant}, tool_call ${byType.tool_call}, tool_result ${byType.tool_result})`,
  );
  lines.push(`${label('wall clock')}${stats.wallClockMs === null ? '--' : formatDuration(stats.wallClockMs)}`);

  const toolTimeShare = stats.wallClockMs !== null && stats.wallClockMs > 0 ? stats.toolTimeMs / stats.wallClockMs : null;
  lines.push(
    `${label('tool time')}${formatDuration(stats.toolTimeMs)}${
      toolTimeShare === null ? '' : `  (${formatPercent(toolTimeShare)} of wall clock)`
    }`,
  );

  lines.push(
    `${label('tool calls')}${stats.toolCalls}  (${stats.toolCompleted} completed, ${stats.pendingCalls} pending, ${stats.toolFailures} failed = ${formatPercent(stats.failureRate)} failure rate)`,
  );

  lines.push(`${label('tokens')}${stats.tokens.input} in / ${stats.tokens.output} out = ${stats.tokens.total} total`);

  if (stats.tools.length > 0) {
    lines.push('');
    lines.push(renderToolTable(stats.tools));
  }

  if (stats.orphanResults > 0) {
    lines.push('');
    lines.push(`${stats.orphanResults} orphan result(s) could not be matched to a call.`);
  }

  return lines.join('\n');
}

function renderToolTable(tools: readonly ToolStats[]): string {
  const headers = ['tool', 'calls', 'fail', 'total', 'avg', 'max', 'share'];
  const rows = tools.map((tool) => [
    tool.name,
    String(tool.calls),
    String(tool.failures),
    formatDuration(tool.totalMs),
    formatDuration(tool.avgMs),
    formatDuration(tool.maxMs),
    formatPercent(tool.timeShare),
  ]);

  const widths = headers.map((header, col) => Math.max(header.length, ...rows.map((row) => row[col].length)));
  const renderRow = (cells: readonly string[]): string =>
    cells
      .map((cell, col) => (col === 0 ? cell.padEnd(widths[col]) : cell.padStart(widths[col])))
      .join('  ')
      .trimEnd();

  return [renderRow(headers), ...rows.map(renderRow)].join('\n');
}

/** Summary lines put their value at a fixed column so they read as a table without one. */
function label(text: string): string {
  return text.padEnd(14);
}

function pad(eventType: string): string {
  return eventType.padEnd(TYPE_LABEL_WIDTH);
}

function formatOffset(ts: number | null, firstTs: number | null): string {
  if (ts === null || firstTs === null) return '+?';
  return `+${((ts - firstTs) / 1000).toFixed(3)}s`;
}

/** Durations read as seconds once they clear a second; below that, milliseconds are more legible. */
function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms >= 1000) return `${(ms / 1000).toFixed(3)}s`;
  return `${Math.round(ms)}ms`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function truncate(text: string, maxLength: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength)}...`;
}

function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
