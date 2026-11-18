import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Files",
  description: "Browse and search indexed files",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
