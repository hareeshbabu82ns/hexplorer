import Nav from "@/components/Nav";
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
      <Nav />
      <main className="flex flex-col w-full py-20 px-2 xl:px-8 m-auto min-h-screen">
        {children}
      </main>
    </>
  );
}
