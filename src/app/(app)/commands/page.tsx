"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Activity, History, Library, SquareTerminal, Terminal } from "lucide-react";

import { listCmdTargets } from "@/lib/actions/commands";
import { ErrorBanner, Page, PageHeader } from "@/components/app/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Fleet } from "./_components/fleet";
import { RunHistory } from "./_components/history";
import { ScriptLibrary } from "./_components/library";
import { unwrap, type ConsoleSeed } from "./_components/shared";

// the console restores its draft from localStorage, so render it only in the browser
const CommandConsole = dynamic(() => import("./_components/console").then((m) => m.CommandConsole), {
  ssr: false,
});

export default function CommandsPage() {
  const [tab, setTab] = useState("console");
  const [seed, setSeed] = useState<ConsoleSeed | null>(null);
  const { data, error } = useQuery({ queryKey: ["cmd-targets"], queryFn: () => unwrap(listCmdTargets()) });
  const targets = data?.targets ?? [];
  const groups = data?.groups ?? [];

  const open = (s: ConsoleSeed) => {
    setSeed(s);
    setTab("console");
  };

  return (
    <Page>
      <PageHeader
        icon={SquareTerminal}
        title="Commands"
        description="Run commands and multi-step scripts on one or many SSH servers. Select values in any output and feed them into the next step, save scripts with parameters, and keep an eye on fleet health."
      />
      {error && <ErrorBanner>{(error as Error).message}</ErrorBanner>}
      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList>
          <TabsTrigger value="console" className="gap-1.5">
            <Terminal className="size-4" /> Console
          </TabsTrigger>
          <TabsTrigger value="scripts" className="gap-1.5">
            <Library className="size-4" /> Scripts
          </TabsTrigger>
          <TabsTrigger value="fleet" className="gap-1.5">
            <Activity className="size-4" /> Fleet
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="size-4" /> History
          </TabsTrigger>
        </TabsList>
        {/* the console stays mounted so running steps keep streaming while you browse other tabs */}
        <TabsContent value="console" forceMount className="data-[state=inactive]:hidden">
          <CommandConsole targets={targets} groups={groups} seed={seed} />
        </TabsContent>
        <TabsContent value="scripts">
          <ScriptLibrary onOpen={open} />
        </TabsContent>
        <TabsContent value="fleet">
          <Fleet targets={targets} onOpen={open} />
        </TabsContent>
        <TabsContent value="history">
          <RunHistory onOpen={open} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
