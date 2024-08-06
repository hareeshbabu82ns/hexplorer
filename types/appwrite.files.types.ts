import { Models } from "node-appwrite";

export interface DbFile extends Models.Document {
  name: string;
  path: string;
  birthDate: Date;
  modifiedDate: Date;
  size?: number;
  isDirectory?: boolean;
}

export type CreateDbFileParams = {
  name: string;
  path: string;
  birthDate: Date;
  modifiedDate: Date;
  size?: number;
  isDirectory?: boolean;
};
