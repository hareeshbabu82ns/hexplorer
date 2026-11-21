"use server";

import type { Document } from "mongodb";
import {
  parseEjson,
  parseFilter,
  parseId,
  parseObject,
  restoreNumericTypes,
  toCanonical,
  toRelaxed,
} from "@/lib/db-admin/ejson";
import { DbAdminError } from "@/lib/db-admin/errors";
import { validateCollectionName, validateDatabaseName } from "@/lib/db-admin/names";
import { getClient } from "@/lib/db-admin/pool";
import { mutate, read } from "@/lib/db-admin/run";
import type { FindQuery, FindResult } from "@/lib/db-admin/types";

const MAX_LIMIT = 200;

async function collOf(connectionId: string, database: string, collection: string, write = false) {
  const { client } = await getClient(connectionId);
  return client
    .db(validateDatabaseName(database))
    .collection(validateCollectionName(collection, { allowSystem: !write }));
}

export async function findDocuments(connectionId: string, database: string, collection: string, q: FindQuery = {}) {
  return read("Failed to query documents", async (): Promise<FindResult> => {
    const coll = await collOf(connectionId, database, collection);
    const filter = parseFilter(q.filter);
    const sort = parseObject(q.sort, "sort");
    const projection = parseObject(q.projection, "projection");
    const limit = Math.min(Math.max(1, Math.floor(Number(q.limit) || 20)), MAX_LIMIT);
    const skip = Math.max(0, Math.floor(Number(q.skip) || 0));

    let cursor = coll.find(filter, { maxTimeMS: 30_000 });
    if (Object.keys(sort).length) cursor = cursor.sort(sort as Record<string, 1 | -1>);
    if (Object.keys(projection).length) cursor = cursor.project(projection);
    const docs = await cursor.skip(skip).limit(limit).toArray();

    let total: number;
    let estimated = false;
    try {
      total = await coll.countDocuments(filter, { maxTimeMS: 10_000 });
    } catch (e) {
      if (Object.keys(filter).length) throw e;
      total = await coll.estimatedDocumentCount();
      estimated = true;
    }
    return { documents: docs.map(toRelaxed), total, estimated };
  });
}

/** one object or an array of objects, as Extended JSON */
export async function insertDocuments(connectionId: string, database: string, collection: string, json: string) {
  return mutate(
    (d?: { insertedCount: number }) => ({
      action: "document.insert",
      connectionId,
      target: `${database}.${collection}`,
      details: d ? { insertedCount: d.insertedCount } : {},
    }),
    "Failed to insert documents",
    async () => {
      const coll = await collOf(connectionId, database, collection, true);
      const parsed = parseEjson(json, "document JSON");
      const docs = (Array.isArray(parsed) ? parsed : [parsed]) as Document[];
      if (!docs.length) throw new DbAdminError("Nothing to insert");
      if (docs.some((d) => !d || typeof d !== "object" || Array.isArray(d)))
        throw new DbAdminError("Each document must be a JSON object");
      const res = await coll.insertMany(docs, { ordered: true });
      return { insertedCount: res.insertedCount, ids: Object.values(res.insertedIds).map(toRelaxed) };
    },
  );
}

export async function replaceDocument(
  connectionId: string,
  database: string,
  collection: string,
  idJson: string,
  json: string,
) {
  return mutate(
    { action: "document.replace", connectionId, target: `${database}.${collection}`, details: { id: idJson } },
    "Failed to save document",
    async () => {
      const coll = await collOf(connectionId, database, collection, true);
      const id = parseId(idJson);
      // parse as EJSON so Date / Long / Decimal values keep their BSON types
      const next = parseEjson(json, "document JSON");
      if (!next || typeof next !== "object" || Array.isArray(next))
        throw new DbAdminError("The document must be a JSON object");
      const doc = next as Document;
      if ("_id" in doc && toCanonical(doc._id) !== toCanonical(id))
        throw new DbAdminError("Changing _id is not allowed (duplicate the document instead)");
      // unpromoted, so Int32 / Long / Double wrappers tell us the stored numeric types
      const current = await coll.findOne({ _id: id as any }, { promoteValues: false, promoteLongs: false });
      if (!current) throw new DbAdminError("Document not found (it may have been deleted)");
      const { _id: _drop, ...rest } = restoreNumericTypes(doc, current) as Document;
      const res = await coll.replaceOne({ _id: id as any }, rest);
      if (!res.matchedCount) throw new DbAdminError("Document not found (it may have been deleted)");
      const saved = await coll.findOne({ _id: id as any });
      return { document: toRelaxed(saved) };
    },
  );
}

export async function deleteDocument(connectionId: string, database: string, collection: string, idJson: string) {
  return mutate(
    { action: "document.delete", connectionId, target: `${database}.${collection}`, details: { id: idJson } },
    "Failed to delete document",
    async () => {
      const coll = await collOf(connectionId, database, collection, true);
      const res = await coll.deleteOne({ _id: parseId(idJson) as any });
      if (!res.deletedCount) throw new DbAdminError("Document not found");
      return { deletedCount: res.deletedCount };
    },
  );
}

/** delete every document matching a non-empty filter; confirmName must be the collection name */
export async function deleteMatching(
  connectionId: string,
  database: string,
  collection: string,
  filterJson: string,
  confirmName: string,
) {
  return mutate(
    (d?: { deletedCount: number }) => ({
      action: "document.deleteMany",
      connectionId,
      target: `${database}.${collection}`,
      details: { filter: filterJson, ...(d ? { deletedCount: d.deletedCount } : {}) },
    }),
    "Failed to delete documents",
    async () => {
      if (confirmName !== collection) throw new DbAdminError("Confirmation does not match the collection name");
      const filter = parseFilter(filterJson);
      if (!Object.keys(filter).length)
        throw new DbAdminError("A non-empty filter is required (use Clear collection to delete everything)");
      const coll = await collOf(connectionId, database, collection, true);
      const res = await coll.deleteMany(filter);
      return { deletedCount: res.deletedCount };
    },
  );
}
