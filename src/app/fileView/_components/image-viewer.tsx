"use client";

import Image from "next/image";
import React from "react";

interface CompProps {
  filePath: string;
}
const ImageViewer = ({ filePath }: CompProps) => {
  return (
    <div>
      <Image
        src={`/api/assets/${filePath}`}
        alt={filePath}
        height={200}
        width={300}
      />
    </div>
  );
};

export default ImageViewer;
