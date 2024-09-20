"use server";

import {
  AppwriteInitDBFieldType,
  databases,
  DB_INIT,
  permissionsAllAny,
  PUBLIC_BUCKET_ID,
  storage,
} from "@/lib/appwrite.config";

// CREATE APPWRITE DATABASE
export const initDB = async () => {
  // create public bucket
  try {
    await storage.getBucket(PUBLIC_BUCKET_ID!);
  } catch (error) {
    // bucket not found
    try {
      await storage.createBucket(
        PUBLIC_BUCKET_ID!,
        "PublicBucket",
        permissionsAllAny,
        false,
        true,
        30 * 1000000, // 30MB
        undefined,
        undefined,
        false,
        true,
      );
    } catch (error) {
      console.error("Failed to create bucket:", error);
    }
  }
  // create db
  try {
    await databases.get(DB_INIT.db.id);
  } catch (error) {
    // database not found
    try {
      await databases.create(DB_INIT.db.id, DB_INIT.db.name, true);
    } catch (error) {
      console.error("Failed to create database:", error);
    }
  }

  // create collections
  for (const collection of DB_INIT.collections) {
    try {
      await databases.getCollection(DB_INIT.db.id, collection.id);
    } catch (error) {
      // collection not found
      try {
        await databases.createCollection(
          DB_INIT.db.id,
          collection.id,
          collection.name,
          collection.permissions,
          false,
          true,
        );
      } catch (error) {
        console.error("Failed to create collection:", collection.id, error);
      }
    }
  }

  // create collection fields
  for (const collection of DB_INIT.collections) {
    try {
      await databases.getCollection(DB_INIT.db.id, collection.id);

      // create collection fields
      for (const field of collection.fields) {
        try {
          await databases.getAttribute(DB_INIT.db.id, collection.id, field.key);
        } catch (error) {
          // field not found, create
          try {
            switch (field.type) {
              case AppwriteInitDBFieldType.INTEGER:
                await databases.createIntegerAttribute(
                  DB_INIT.db.id,
                  collection.id,
                  field.key,
                  field.required ?? false,
                  field.min,
                  field.max,
                  field.required ? undefined : Number(field.default),
                );
                break;
              case AppwriteInitDBFieldType.FLOAT:
                await databases.createFloatAttribute(
                  DB_INIT.db.id,
                  collection.id,
                  field.key,
                  field.required ?? false,
                  field.min,
                  field.max,
                  field.required ? undefined : Number(field.default),
                );
                break;
              case AppwriteInitDBFieldType.BOOLEAN:
                await databases.createBooleanAttribute(
                  DB_INIT.db.id,
                  collection.id,
                  field.key,
                  field.required ?? false,
                  field.required ? undefined : field.default === "true",
                );
                break;
              case AppwriteInitDBFieldType.DATETIME:
                await databases.createDatetimeAttribute(
                  DB_INIT.db.id,
                  collection.id,
                  field.key,
                  field.required ?? false,
                );
                break;
              case AppwriteInitDBFieldType.ENUM:
                await databases.createEnumAttribute(
                  DB_INIT.db.id,
                  collection.id,
                  field.key,
                  field.elements ?? [],
                  field.required ?? false,
                  field.required ? undefined : field.default,
                );
                break;
              default:
                await databases.createStringAttribute(
                  DB_INIT.db.id,
                  collection.id,
                  field.key,
                  field.size ?? 100,
                  field.required ?? false,
                  field.required ? undefined : field.default,
                );
                break;
            }
          } catch (error) {
            console.error("Failed to create collection field:", field, error);
          }
        }
      }
    } catch (error) {
      console.error("Collection not found", collection.id, error);
    }
  }
};
