"use client";

import React from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { usePathname } from "next/navigation";

type Props = { customLabels?: Record<string, string> };

export default function BreadcrumbsPath({ customLabels }: Props) {
  const pathname = usePathname().replace(/^\/files/, "");

  const generateBreadcrumbs = () => {
    const pathSegments = pathname.split("/").filter((segment) => segment);
    const breadcrumbs = pathSegments.map((segment, index) => {
      const href = "/files/" + pathSegments.slice(0, index + 1).join("/");
      return { segment, href };
    });
    return breadcrumbs;
  };

  const breadcrumbs = generateBreadcrumbs();

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {pathname === "" ? (
            <span className="text-white font-bold">Home</span>
          ) : (
            <BreadcrumbLink href="/files/">Home</BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {breadcrumbs.map((breadcrumb, index) => (
          <React.Fragment key={breadcrumb.href}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {index === breadcrumbs.length - 1 ? (
                <span className="text-white font-bold">
                  {(customLabels && customLabels[breadcrumb.segment]) ||
                    decodeURIComponent(breadcrumb.segment)}
                </span>
              ) : (
                <BreadcrumbLink href={breadcrumb.href}>
                  {(customLabels && customLabels[breadcrumb.segment]) ||
                    decodeURIComponent(breadcrumb.segment)}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
