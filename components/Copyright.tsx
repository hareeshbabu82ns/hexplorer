"use client";

import React from "react";
import Link from "next/link";
import { Button } from "./ui/button";

type Props = {};

export default function Copyright({}: Props) {
  const currentYear = new Date().getFullYear();

  return (
    <div className="flex flex-col items-center justify-center pt-20 text-muted-foreground gap-6">
      <p className="text-xs md:text-sm text-center">
        Copyright &copy; {currentYear} TerabitsIO. <br className="lg:hidden" />
      </p>
    </div>
  );
}
