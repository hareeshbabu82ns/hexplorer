"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import BreadcrumbsPath from "../../components/BreadcrumbsPath";

export default function Nav() {
  return (
    <nav className="flex items-center">
      <div className="flex flex-row items-center justify-center gap-2">
        <h2 className="text-xl font-bold tracking-tight">Files</h2>
      </div>

      <span className="px-4" />

      <BreadcrumbsPath />

      <span className="grow" />

      <div className="flex flex-row items-center gap-4">
        {/* right actions */}
      </div>
    </nav>
  );
}
