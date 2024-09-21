"use client";

import { useQuery } from "@tanstack/react-query";
import { getFileData } from "../actions";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface CompProps {
  filePath: string;
}
const MarkdownViewer = ({ filePath }: CompProps) => {
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

  return (
    <div className="md p-8 text-lg">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: (props) => {
            const { node, className, children, ...rest } = props;
            // console.log("pre:", node);
            return (
              <pre
                {...rest}
                className={cn(
                  className,
                  "my-2 overflow-auto rounded-sm border p-2 px-4 italic",
                )}
              >
                {children}
              </pre>
            );
          },
          img: (props) => {
            const { node, ...rest } = props;
            const endOffset = node?.position?.end.offset;
            // read next string between { and } after endOffset
            if (
              endOffset &&
              data.substring(endOffset, endOffset + 8) === "{:height"
            ) {
              //
              const imgSizeStr = data.substring(
                endOffset + 1,
                data.indexOf("}", endOffset),
              );
              // console.log("ImgSize:", imgSizeStr);
              // extract height and width from imgSizeStr ':height 312, :width 104'
              const [height, width] = imgSizeStr
                .split(",")
                .map((str) => str.trim())
                .map((str) => str.split(" ")[1])
                .map((str) => parseInt(str));

              return (
                <Image
                  {...rest}
                  src={rest.src || ""}
                  alt={rest.alt || "image"}
                  height={height}
                  width={width}
                />
              );
            } else {
              return (
                <Image
                  {...rest}
                  src={rest.src || ""}
                  alt={rest.alt || "image"}
                  objectFit="cover"
                  height={400}
                  width={600}
                />
              );
            }
          },
        }}
      >
        {data}
      </Markdown>
    </div>
  );
};

export default MarkdownViewer;
