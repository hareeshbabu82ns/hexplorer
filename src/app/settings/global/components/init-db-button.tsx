"use client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/Icons";
import { initDB } from "../actions";

export default function InitDBButton() {
  const { mutate: initDBFn, isPending } = useMutation({
    mutationFn: initDB,
    onSuccess: () => {
      toast.success("Appwrite DB initiated!");
    },
    onError: () => {
      toast.error("Failed to initiate DB.");
    },
  });

  return (
    <div className="flex flex-row items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <div className="text-base">Initiate DB</div>
        <div>Create required tables, indexes and inital config data</div>
      </div>
      <div>
        <Button
          size={"icon"}
          variant={"secondary"}
          onClick={() => initDBFn()}
          disabled={isPending}
        >
          <Icons.settings className="size-4" />
        </Button>
      </div>
    </div>
  );
}
