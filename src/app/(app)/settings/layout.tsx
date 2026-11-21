import { Metadata } from "next";
import { Settings } from "lucide-react";
import { Page, PageHeader } from "@/components/app/page";
import { SidebarNav } from "./components/sidebar-nav";

export const metadata: Metadata = {
  title: "Settings",
  description: "Explore Settings",
};

const sidebarNavItems = [
  {
    title: "Global",
    href: "/settings/global",
  },
  {
    title: "Security",
    href: "/settings/security",
  },
  {
    title: "Appearance",
    href: "/settings/appearance",
  },
  {
    title: "Extras",
    href: "/settings/extras",
  },
];

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Page>
      <PageHeader icon={Settings} title="Settings" description="Server-wide preferences, security and appearance." />
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <aside className="-mx-1 overflow-x-auto lg:w-52 lg:shrink-0">
          <SidebarNav items={sidebarNavItems} />
        </aside>
        <div className="surface min-w-0 flex-1 p-5 md:p-8 lg:max-w-3xl">{children}</div>
      </div>
    </Page>
  );
}
