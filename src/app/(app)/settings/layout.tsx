import { Metadata } from "next";
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
    <>
      <div className="space-y-6 px-4 py-6 pb-16 md:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
          <aside className="-mx-1 overflow-x-auto lg:w-48 lg:shrink-0">
            <SidebarNav items={sidebarNavItems} />
          </aside>
          <div className="flex-1 lg:max-w-2xl">{children}</div>
        </div>
      </div>
    </>
  );
}
