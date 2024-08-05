"use client";

import Link from "next/link";
import Image from "next/image";
import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ModeToggle } from "../../components/ui/toggle-mode";
import BreadcrumbsPath from "../../components/BreadcrumbsPath";
import { Icons } from "../../components/Icons";
import { Button } from "../../components/ui/button";

export default function Nav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="supports-backdrop-blur:bg-background/60 bg-background/50 backdrop-blur">
      <nav className="flex h-14 items-center px-8">
        <div className="flex flex-row items-center justify-center gap-2">
          <h1 className="font-bold">Files</h1>
        </div>

        <span className="px-4" />

        <BreadcrumbsPath />

        <span className="grow" />

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger>
            <Icons.menu className="flex md:hidden" />
          </SheetTrigger>
          <SheetContent className="supports-backdrop-blur:bg-background/80 bg-background/80 flex w-[70%] flex-col items-center gap-8 border-b px-10 pt-16 backdrop-blur">
            <div className="flex flex-row gap-4">
              <ModeToggle />
            </div>

            <div className="grow" />
            <Link
              href="/"
              className="hover:text-primary"
              onClick={() => setSheetOpen(false)}
            >
              <p className="flex flex-row items-center gap-2 text-lg font-bold">
                <Image
                  className="animate-tilt"
                  src="/tidning.png"
                  alt="Tidning Logo"
                  width={24}
                  height={24}
                  priority
                />
                Hexplorer
              </p>
            </Link>
            <div className="my-4" />
          </SheetContent>
        </Sheet>

        <div className="hidden flex-row items-center gap-4 md:flex">
          {/* right actions */}
        </div>
      </nav>
    </div>
  );
}
