"use client";

import React from "react";
import Link from "next/link";
import { Button } from "./ui/button";

type Props = {};

export default function Copyright({}: Props) {
  const currentYear = new Date().getFullYear();

  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-6 pt-20">
      <p className="text-center text-xs md:text-sm">
        Copyright &copy; {currentYear} TerabitsIO. <br className="lg:hidden" />
      </p>
    </div>
  );
}
