"use client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/Icons";
import { syncFiles } from "@/lib/actions/files";
import { usePathname } from "next/navigation";

export default function ResyncFilesButton() {
  const pathname = decodeURI(usePathname().replace(/^\/files/, ""));

  const { mutate: syncFilesFn, isPending } = useMutation({
    mutationFn: syncFiles,
    onSuccess: () => {
      toast.success("Appwrite DB initiated!");
    },
    onError: () => {
      toast.error("Failed to initiate DB.");
    },
  });

  return (
    <Button
      size={"icon"}
      variant={"outline"}
      onClick={() => syncFilesFn({ path: pathname, recursive: true })}
      disabled={isPending}
    >
      <Icons.sync className="size-4" />
    </Button>
  );
}
