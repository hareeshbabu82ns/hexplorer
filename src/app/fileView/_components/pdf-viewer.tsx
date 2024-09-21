"use client";

import { useQuery } from "@tanstack/react-query";
import { getFileData } from "../actions";

interface CompProps {
  filePath: string;
}
const PDFViewer = ({ filePath }: CompProps) => {
  const { data, isFetching, isLoading, error } = useQuery({
    queryKey: ["fileData", filePath],
    queryFn: async () => {
      const response = await getFileData(filePath);
      return response.data;
    },
  });
  if (isLoading || isFetching) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!data) return <div>No data</div>;

  return <div className="md p-8 text-lg"></div>;
};

export default PDFViewer;
