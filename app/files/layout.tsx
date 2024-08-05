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
      <Nav />
      <main className="m-auto flex w-full flex-col px-2 py-20 xl:px-8">
        {children}
      </main>
    </>
  );
}
