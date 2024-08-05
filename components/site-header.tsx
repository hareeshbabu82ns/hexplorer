import Link from "next/link";

import { siteConfig } from "@/config/site";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icons } from "@/components/Icons";
import { MainNav } from "@/components/main-nav";
import { ModeToggle } from "./ui/toggle-mode";

export function SiteHeader() {
  return (
    <header className="supports-backdrop-blur:bg-background/60 bg-background/50 sticky top-0 z-40 w-full border-b backdrop-blur">
      <div className="mx-2 flex h-16 items-center space-x-4 sm:justify-between sm:space-x-0 md:mx-4">
        <MainNav items={siteConfig.mainNav} />
        <div className="flex flex-1 items-center justify-end space-x-4">
          <nav className="hidden flex-row items-center gap-2 md:flex">
            <Link
              href={siteConfig.links.github}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" size="icon">
                <Icons.gitHub className="size-5" />
                <span className="sr-only">GitHub</span>
              </Button>
            </Link>
            {/* <Link
              href={siteConfig.links.twitter}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" size="icon">
                <Icons.twitter className="size-4 fill-current" />
                <span className="sr-only">Twitter</span>
              </Button>
            </Link> */}
          </nav>
        </div>
      </div>
    </header>
  );
}
