import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hexplorer - Settings",
  description: "Explore Settings",
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
