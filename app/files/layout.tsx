import { Separator } from "@/components/ui/separator";
import Nav from "./Nav";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hexplorer - Files",
  description: "Explore Files",
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <div className="space-y-6 px-4 py-2 pb-16 md:px-10">
        <Nav />
        <Separator className="my-6" />
        <main className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
          <div className="flex-1">{children}</div>
        </main>
      </div>
    </>
  );
}
