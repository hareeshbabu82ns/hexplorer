import { databases, permissionsAllAny } from "@/lib/appwrite.config";

// Create database
export const createDatabase = async (id: string, name: string) => {
  try {
    const res = await databases.create(id, name, true);
    return res;
  } catch (error) {
    console.error("Failed to create database:", error);
  }
};

// Create collection
export const createCollection = async (
  databaseId: string,
  collectionId: string,
  collectionName: string
) => {
  try {
    const data = await databases.createCollection(
      databaseId,
      collectionId,
      collectionName,
      permissionsAllAny,
      false,
      true
    );

    return data;
  } catch (error) {
    console.error("Failed to create collection:", error);
  }
};
