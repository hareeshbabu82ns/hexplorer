"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustomRole, RoleRef } from "@/lib/db-admin/types";

export const DB_ROLES: Record<string, string> = {
  read: "Read all non-system collections",
  readWrite: "Read and modify data",
  dbAdmin: "Schema, indexes, stats (no data access)",
  dbOwner: "readWrite + dbAdmin + userAdmin on the database",
  userAdmin: "Create and modify users and roles on the database",
};

/** built-in roles that only exist on admin */
export const ADMIN_ROLES: Record<string, string> = {
  readAnyDatabase: "read on every database",
  readWriteAnyDatabase: "readWrite on every database",
  dbAdminAnyDatabase: "dbAdmin on every database",
  userAdminAnyDatabase: "userAdmin on every database",
  clusterMonitor: "Read-only monitoring (serverStatus, …)",
  clusterManager: "Manage and monitor the cluster",
  clusterAdmin: "Full cluster administration",
  backup: "Back up any database",
  restore: "Restore from backups",
  root: "Superuser: everything",
};

const CUSTOM_PREFIX = "custom:";

export function roleDescription(role: string) {
  return DB_ROLES[role] ?? ADMIN_ROLES[role] ?? "Custom role";
}

export function RoleEditor({
  value,
  onChange,
  customRoles,
  databases,
}: {
  value: RoleRef[];
  onChange: (v: RoleRef[]) => void;
  customRoles: CustomRole[];
  databases: string[];
}) {
  const defaultDb = databases.find((d) => !["admin", "local", "config"].includes(d)) ?? "";
  const set = (i: number, r: RoleRef) => onChange(value.map((x, j) => (j === i ? r : x)));
  return (
    <div className="grid gap-2">
      {value.map((r, i) => {
        const isAdminRole = r.role in ADMIN_ROLES;
        const custom = customRoles.find((c) => c.role === r.role && c.db === r.db);
        const selectValue = custom ? `${CUSTOM_PREFIX}${r.db}:${r.role}` : r.role;
        return (
          <div key={i} className="grid gap-1 rounded-md border p-2">
            <div className="flex gap-2">
              <Select
                value={selectValue}
                onValueChange={(v) => {
                  if (v.startsWith(CUSTOM_PREFIX)) {
                    const [db, ...role] = v.slice(CUSTOM_PREFIX.length).split(":");
                    set(i, { role: role.join(":"), db });
                  } else set(i, { role: v, db: v in ADMIN_ROLES ? "admin" : isAdminRole || custom ? defaultDb : r.db });
                }}
              >
                <SelectTrigger className="w-1/2">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Database roles</SelectLabel>
                    {Object.keys(DB_ROLES).map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Admin roles (db = admin)</SelectLabel>
                    {Object.keys(ADMIN_ROLES).map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customRoles.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Custom roles</SelectLabel>
                      {customRoles.map((c) => (
                        <SelectItem key={`${c.db}:${c.role}`} value={`${CUSTOM_PREFIX}${c.db}:${c.role}`}>
                          {c.role} @ {c.db}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <Input
                list="role-editor-dbs"
                className="w-1/2 font-mono"
                placeholder="database"
                value={r.db}
                disabled={isAdminRole || !!custom}
                onChange={(e) => set(i, { ...r, db: e.target.value })}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove role"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{roleDescription(r.role)}</p>
          </div>
        );
      })}
      <datalist id="role-editor-dbs">
        {databases.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...value, { role: "read", db: defaultDb }])}
      >
        <Plus className="mr-1 size-4" /> Add role
      </Button>
    </div>
  );
}
