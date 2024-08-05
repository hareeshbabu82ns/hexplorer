import { Metadata } from "next";
import { Separator } from "@/components/ui/separator";
import { SidebarNav } from "./components/sidebar-nav";

export const metadata: Metadata = {
  title: "Hexplorer - Settings",
  description: "Explore Settings",
};

const sidebarNavItems = [
  {
    title: "Global",
    href: "/settings/global",
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
    <>
      <div className="space-y-6 px-4 py-2 pb-16 md:px-10">
        <div className="space-y-0.5">
          <h2 className="text-xl font-bold tracking-tight">Settings</h2>
        </div>
        <Separator className="my-6" />
        <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
          <aside className="-mx-4 lg:w-1/5">
            <SidebarNav items={sidebarNavItems} />
          </aside>
          <div className="flex-1 lg:max-w-2xl">{children}</div>
        </div>
      </div>
    </>
  );
}
