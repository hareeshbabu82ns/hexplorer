"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchDuplicateFiles } from "@/lib/actions/files";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DuplicateFilesDlgBtn() {
  const pathname = decodeURI(usePathname().replace(/^\/files/, ""));

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ["duplicate-files", { filePath: pathname }],
    queryFn: async () => {
      return await fetchDuplicateFiles({ filePath: pathname });
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Duplicates</Button>
      </DialogTrigger>
      <DialogContent className="min-w-full">
        <DialogHeader>
          <DialogTitle>Duplicate Files</DialogTitle>
          <DialogDescription>
            Duplicate Files under the path <code>{pathname}</code>
          </DialogDescription>
        </DialogHeader>
        <div className="flex h-[800px] flex-col items-center gap-2 space-x-2 overflow-auto">
          {isLoading || (isFetching && <>Loading...</>)}
          {/* <pre>{JSON.stringify(data, null, 2)}</pre> */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="">Name</TableHead>
                <TableHead className="">Path</TableHead>
                <TableHead className="text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((file, idx) => (
                <TableRow key={file.name + `${idx}`}>
                  <TableCell className="font-medium">{file.name}</TableCell>
                  <TableCell>{file.path}</TableCell>
                  <TableCell className="text-right">{file.size}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter className="sm:justify-start"></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
