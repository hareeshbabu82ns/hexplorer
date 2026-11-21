import { BSON, Decimal128, Double, Int32, Long, ObjectId } from "mongodb";
import { DbAdminError } from "./errors";

export const EJSON = BSON.EJSON;
type Doc = Record<string, unknown>;

/** parse Extended JSON (canonical rules, so $oid / $date / $numberLong keep their BSON types) */
export function parseEjson(text: string, what: string): unknown {
  try {
    return EJSON.parse(text, { relaxed: false });
  } catch (e) {
    throw new DbAdminError(`Invalid ${what}: ${(e as Error).message}`);
  }
}

const isPlainObject = (v: unknown): v is Doc =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** parse an optional JSON object input; empty text = {} */
export function parseObject(text: string | undefined | null, what: string): Doc {
  const t = (text ?? "").trim();
  if (!t) return {};
  const v = parseEjson(t, what);
  if (!isPlainObject(v)) throw new DbAdminError(`${what} must be a JSON object`);
  return v;
}

/** filter input; a bare 24-hex string (optionally quoted) means { _id: ObjectId(...) } */
export function parseFilter(text: string | undefined | null): Doc {
  const t = (text ?? "").trim();
  const hex = /^["']?([0-9a-fA-F]{24})["']?$/.exec(t);
  if (hex) return { _id: new ObjectId(hex[1]) };
  return parseObject(t, "filter");
}

export const toRelaxed = (v: unknown) => EJSON.stringify(v, { relaxed: true });
export const toCanonical = (v: unknown) => EJSON.stringify(v, { relaxed: false });

/** a document _id sent back by the browser as an EJSON string */
export function parseId(idJson: string): unknown {
  const t = (idJson ?? "").trim();
  if (!t) throw new DbAdminError("Document id is required");
  if (/^[0-9a-fA-F]{24}$/.test(t)) return new ObjectId(t);
  return parseEjson(t, "document id");
}

const bsonType = (v: unknown) => (v as { _bsontype?: string } | null)?._bsontype;

/**
 * The browser edits relaxed EJSON, where Long and Double show as plain numbers.
 * Put numbers back into the numeric BSON type the stored document had, so an
 * edit does not silently turn a Long into an Int32 (Dates and Decimals already
 * survive as {"$date"} / {"$numberDecimal"}).
 */
export function restoreNumericTypes(next: unknown, prev: unknown): unknown {
  if (Array.isArray(next)) {
    const p = Array.isArray(prev) ? prev : [];
    return next.map((v, i) => restoreNumericTypes(v, p[i]));
  }
  if (isPlainObject(next)) {
    const p = isPlainObject(prev) ? prev : {};
    const out: Doc = {};
    for (const [k, v] of Object.entries(next)) out[k] = restoreNumericTypes(v, p[k]);
    return out;
  }
  const nt = bsonType(next) ?? (typeof next === "number" ? "number" : null);
  if (!nt || !["Int32", "Double", "Long", "number"].includes(nt)) return next;
  const value = Number(nt === "Long" ? (next as Long).toString() : nt === "number" ? next : (next as Int32 | Double).valueOf());
  switch (bsonType(prev)) {
    case "Long":
      return Number.isInteger(value) ? Long.fromNumber(value) : next;
    case "Double":
      return new Double(value);
    case "Int32":
      return Number.isInteger(value) && Math.abs(value) < 2 ** 31 ? new Int32(value) : next;
    default:
      if (typeof prev === "number") return Number.isInteger(prev) ? next : new Double(value);
      return next;
  }
}

export { Decimal128 };
