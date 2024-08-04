import * as sdk from "node-appwrite";

export const {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY,
  HEXPLORER_DB_ID,
  FILES_COLL_ID,
  PUBLIC_BUCKET_ID,
} = process.env;

const client = new sdk.Client();

client
  .setEndpoint(APPWRITE_ENDPOINT!)
  .setProject(APPWRITE_PROJECT_ID!)
  .setKey(APPWRITE_API_KEY!);

export const databases = new sdk.Databases(client);
export const users = new sdk.Users(client);
export const messaging = new sdk.Messaging(client);
export const storage = new sdk.Storage(client);

export enum AppwriteInitDBFieldType {
  STRING = "string",
  INTEGER = "integer",
  FLOAT = "float",
  BOOLEAN = "boolean",
  DATETIME = "datetime",
  EMAIL = "email",
  URL = "url",
  ENUM = "enum",
  RELATION = "relation",
  IP = "ip",
}

export const permissionsAllAny: string[] = [
  'read("any")',
  'write("any")',
  'delete("any")',
  'update("any")',
];

export const DB_INIT = {
  db: {
    id: HEXPLORER_DB_ID!,
    name: "HExplorer",
  },
  collections: [
    {
      id: FILES_COLL_ID!,
      name: "Files",
      permissions: permissionsAllAny,
      fields: [
        {
          key: "name",
          type: AppwriteInitDBFieldType.STRING,
          required: true,
          default: "",
        },
        {
          key: "path",
          type: AppwriteInitDBFieldType.STRING,
          required: true,
          size: 5000,
        },
        {
          key: "birthDate",
          type: AppwriteInitDBFieldType.DATETIME,
          required: true,
        },
        {
          key: "modifiedDate",
          type: AppwriteInitDBFieldType.DATETIME,
          required: true,
        },
        {
          key: "size",
          type: AppwriteInitDBFieldType.INTEGER,
          default: "0",
        },
      ],
    },
  ],
};
