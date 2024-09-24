"use server";

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const fetchSettings = async (domain: string, key?: string) => {
  if (key) {
    return db.settings.findFirst({ where: { domain, key } });
  } else {
    return db.settings.findMany({ where: { domain } });
  }
};

export const updateSettings = async ({
  domain,
  settings,
}: {
  domain: string;
  settings: { key: string; value: string }[];
}) => {
  const oldSettings = await db.settings.findMany({ where: { domain } });
  const newSettings: Prisma.SettingsCreateInput[] = [];
  const updatedSettings: Prisma.SettingsUpdateArgs[] = [];

  settings.forEach(({ key, value }) => {
    const setting = oldSettings.find((s) => s.key === key);
    if (setting) {
      updatedSettings.push({
        where: { id: setting.id },
        data: { value },
      });
    } else {
      newSettings.push({ domain, key, value });
    }
  });

  if (newSettings.length) {
    await db.settings.createMany({ data: newSettings });
  }
  for (const updatedSetting of updatedSettings) {
    await db.settings.update(updatedSetting);
  }
  return true;
};
