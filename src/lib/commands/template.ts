/**
 * Pure helpers shared by the Commands UI (preview) and the server (execution).
 *
 * Template syntax (inside a command):
 *   {{name}}            script parameter / built-in, inserted as-is
 *   {{name|q}}          shell single-quoted
 *   {{sel}}             values selected from the previous step's output, space separated
 *   {{sel|q}}           each value quoted, space separated
 *   {{sel|lines}}       newline separated        {{sel|csv}}  comma separated
 *   {{sel|first}} {{sel|last}} {{sel|count}} {{sel|json}}
 *   {{sel.0}}           n-th selected value (0 based)
 *   {{item}}            current value when a step runs "for each selected value"
 *   {{host}} {{target}} {{user}}  the target being run on
 */

export type ParamType = "text" | "number" | "select" | "bool" | "secret";

export interface ScriptParam {
  name: string;
  label?: string;
  type: ParamType;
  default?: string;
  /** select options */
  options?: string[];
  required?: boolean;
  description?: string;
}

export type PickDelimiter = "whitespace" | "spaces2" | "tab" | "comma" | "colon" | "pipe";

/** rule that selects values from a step's output automatically (for unattended re-runs) */
export interface PickRule {
  /** "lines": whole lines, "column": one column of a parsed table */
  mode: "lines" | "column";
  /** 1 based column (column mode) */
  column?: number;
  delimiter?: PickDelimiter;
  skipHeader?: boolean;
  /** keep only values (lines in lines mode, whole row in column mode) matching this regex */
  match?: string;
  /** drop values matching this regex */
  exclude?: string;
}

export interface ScriptStep {
  id: string;
  title?: string;
  command: string;
  /** run once per selected value with {{item}} */
  foreach?: boolean;
  /** automatic selection for the NEXT step */
  pick?: PickRule | null;
  sudo?: boolean;
  continueOnError?: boolean;
  timeoutSec?: number;
}

export interface TargetInfo {
  id: string;
  name: string;
  host: string;
  user?: string | null;
}

/** quote a string for a POSIX shell */
export function shq(s: string) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const TOKEN = /\{\{\s*([a-zA-Z_][\w-]*)(?:\.(\d+))?\s*(?:\|\s*([a-z]+)\s*)?\}\}/g;

/** names referenced by a command ({{name}}) */
export function referencedNames(command: string): Set<string> {
  const out = new Set<string>();
  for (const m of command.matchAll(TOKEN)) out.add(m[1]);
  return out;
}

export const BUILTIN_NAMES = new Set(["sel", "item", "host", "target", "user"]);

export function usesSelection(command: string) {
  const n = referencedNames(command);
  return n.has("sel") || n.has("item");
}

function applyFilter(values: string[], filter: string | undefined): string {
  switch (filter) {
    case undefined:
    case "":
      return values.join(" ");
    case "q":
      return values.map(shq).join(" ");
    case "lines":
      return values.join("\n");
    case "csv":
      return values.join(",");
    case "first":
      return values[0] ?? "";
    case "last":
      return values[values.length - 1] ?? "";
    case "count":
      return String(values.length);
    case "json":
      return JSON.stringify(values.length === 1 ? values[0] : values);
    default:
      throw new Error(`Unknown filter |${filter}`);
  }
}

export interface RenderContext {
  params: Record<string, string>;
  sel?: string[];
  item?: string;
  target?: TargetInfo;
}

/** render a command template; throws on unknown names */
export function renderTemplate(command: string, ctx: RenderContext): string {
  return command.replace(TOKEN, (_all, name: string, idx: string | undefined, filter: string | undefined) => {
    let values: string[];
    if (name === "sel") values = ctx.sel ?? [];
    else if (name === "item") values = ctx.item !== undefined ? [ctx.item] : [];
    else if (name === "host") values = [ctx.target?.host ?? ""];
    else if (name === "target") values = [ctx.target?.name ?? ""];
    else if (name === "user") values = [ctx.target?.user ?? ""];
    else if (name in ctx.params) values = [ctx.params[name] ?? ""];
    else throw new Error(`Unknown variable {{${name}}}`);
    if (idx !== undefined) values = values[Number(idx)] !== undefined ? [values[Number(idx)]] : [];
    return applyFilter(values, filter);
  });
}

/* ------------------------------ output parsing ----------------------------- */

const SPLIT: Record<PickDelimiter, RegExp> = {
  whitespace: /\s+/,
  spaces2: /\s{2,}|\t/,
  tab: /\t/,
  comma: /,/,
  colon: /:/,
  pipe: /\s*\|\s*/,
};

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function splitRow(line: string, delimiter: PickDelimiter = "whitespace"): string[] {
  const t = delimiter === "tab" || delimiter === "comma" || delimiter === "colon" ? line : line.trim();
  if (!t) return [];
  return t.split(SPLIT[delimiter]).map((c) => c.trim());
}

/**
 * For whitespace tables, the last column swallows the rest of the line once the header's
 * column count is reached (e.g. `ps aux` COMMAND, `docker ps` NAMES … ).
 */
export function parseTable(
  text: string,
  delimiter: PickDelimiter = "whitespace",
  header = false,
): { header: string[] | null; rows: string[][] } {
  const lines = splitLines(text).filter((l) => l.trim());
  if (!lines.length) return { header: null, rows: [] };
  const head = header ? splitRow(lines[0], delimiter) : null;
  const body = header ? lines.slice(1) : lines;
  let rows = body.map((l) => splitRow(l, delimiter));
  if (head && (delimiter === "whitespace" || delimiter === "spaces2")) {
    const n = head.length;
    rows = rows.map((r) => (r.length > n ? [...r.slice(0, n - 1), r.slice(n - 1).join(" ")] : r));
  }
  return { header: head, rows };
}

/** heuristic: first line looks like a header (mostly upper-case tokens, e.g. df/ps/docker) */
export function looksLikeHeader(text: string): boolean {
  const first = splitLines(text).find((l) => l.trim());
  if (!first) return false;
  const toks = first.trim().split(/\s{1,}/);
  if (toks.length < 2) return false;
  const upper = toks.filter((t) => /^[A-Z][A-Z0-9_%\-/()]*$/.test(t) || /^[A-Z][a-z]+$/.test(t));
  return upper.length / toks.length >= 0.6 && !/^\d/.test(first.trim());
}

function safeRegex(src?: string) {
  if (!src) return null;
  try {
    return new RegExp(src);
  } catch {
    throw new Error(`Invalid regex: ${src}`);
  }
}

/** apply a pick rule to an output */
export function applyPick(text: string, rule: PickRule): string[] {
  const match = safeRegex(rule.match);
  const exclude = safeRegex(rule.exclude);
  const keep = (s: string) => (!match || match.test(s)) && (!exclude || !exclude.test(s));
  if (rule.mode === "lines") {
    const lines = splitLines(text).filter((l) => l.trim());
    return (rule.skipHeader ? lines.slice(1) : lines).filter(keep).map((l) => l.trim());
  }
  const lines = splitLines(text).filter((l) => l.trim());
  const body = rule.skipHeader ? lines.slice(1) : lines;
  const col = Math.max(1, rule.column ?? 1) - 1;
  const { rows } = parseTable(
    (rule.skipHeader ? [lines[0], ...body] : body).join("\n"),
    rule.delimiter ?? "whitespace",
    !!rule.skipHeader,
  );
  return rows
    .map((r, i) => ({ row: body[i] ?? "", v: r[col] }))
    .filter((x) => x.v !== undefined && x.v !== "" && keep(x.row))
    .map((x) => x.v);
}

/* ---------------------------------- safety --------------------------------- */

const DANGER: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, "recursive / forced delete (rm -rf)"],
  [/\b(reboot|shutdown|poweroff|halt)\b/, "reboots or powers off the machine"],
  [/\binit\s+[06]\b/, "changes runlevel (reboot / halt)"],
  [/\bmkfs(\.\w+)?\b/, "formats a filesystem"],
  [/\bdd\s+.*\bof=\/dev\//, "writes raw data to a device"],
  [/>\s*\/dev\/(sd|nvme|vd|hd|mmcblk)/, "writes to a block device"],
  [/\b(wipefs|fdisk|sfdisk|parted|sgdisk)\b/, "modifies disk partitions"],
  [/\bdocker\s+(system|volume|image|container)\s+prune\b/, "prunes docker resources"],
  [/\bdocker\s+(rm|rmi)\b.*\s-f\b/, "force-removes docker resources"],
  [/\b(drop\s+database|dropdb)\b/i, "drops a database"],
  [/\bchmod\s+(-R\s+)?[0-7]*777\s+\//, "opens permissions on system paths"],
  [/\bchown\s+-R\b.*\s\/(\s|$)/, "recursive chown of /"],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, "fork bomb"],
  [/\b(userdel|deluser)\b/, "deletes a user"],
  [/\bsystemctl\s+(stop|disable|mask)\b/, "stops / disables a service"],
  [/\biptables\s+(-F|--flush)\b|\bufw\s+(disable|reset)\b/, "flushes the firewall"],
];

/** reasons a command looks destructive (empty = looks safe) */
export function dangerReasons(command: string): string[] {
  const out = new Set<string>();
  for (const [re, why] of DANGER) if (re.test(command)) out.add(why);
  return [...out];
}

/** replace secret values in a text with •••• */
export function maskSecrets(text: string, secrets: string[]): string {
  let t = text;
  for (const s of secrets) if (s && s.length >= 3) t = t.split(s).join("••••");
  return t;
}
