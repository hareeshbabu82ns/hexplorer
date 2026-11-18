"use server";

import { collections } from "@/lib/db";

export const fetchSettings = async (domain: string) => {
  const { settings } = await collections();
  const docs = await settings.find({ domain }).toArray();
  return docs.map((d) => ({ key: d.key, value: d.value }));
};

export const updateSettings = async ({
  domain,
  settings: values,
}: {
  domain: string;
  settings: { key: string; value: string }[];
}) => {
  const { settings } = await collections();
  if (values.length) {
    await settings.bulkWrite(
      values.map(({ key, value }) => ({
        updateOne: {
          filter: { domain, key },
          update: { $set: { domain, key, value } },
          upsert: true,
        },
      })),
    );
  }
  return true;
};
