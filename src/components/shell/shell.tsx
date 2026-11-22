"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronsUpDown, Menu as MenuIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/client";
import { api } from "@/lib/client/api";
import { can } from "@/lib/workspaces/permissions";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AppDialog } from "../app/app-dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/app/form-field";
import { Input } from "@/components/ui/input";
import { ConversationList } from "./conversation-list";
import { SessionProvider, type SessionInfo } from "./session-context";

function NavLink({ href, label, onNavigate }: { href: string; label: string; onNavigate?: () => void }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        // The start-edge bar marks the current page (a real state), alongside weight and fill.
        "relative h-11 w-full justify-start px-3 text-[15px] font-normal sm:h-9",
        active && "bg-muted font-semibold before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-primary",
      )}
    >
      <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}>
        {label}
      </Link>
    </Button>
  );
}

function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/api/workspaces", { body: { name } });
      onOpenChange(false);
      setName("");
      qc.clear();
      router.push("/chat");
      router.refresh();
    } catch {
      setError(t.common.errorGeneric);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppDialog open={open} onOpenChange={onOpenChange} title={t.nav.newWorkspace}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label={t.nav.workspaceName} error={error ?? undefined}>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />}
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button type="submit" variant="default" disabled={busy || !name.trim()}>
            {t.nav.create}
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}

function SidebarBody({ session, onNavigate }: { session: SessionInfo; onNavigate?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [newWs, setNewWs] = useState(false);
  const active = session.workspaces.find((w) => w.id === session.workspaceId);

  const switchTo = async (id: string) => {
    if (id === session.workspaceId) return;
    await api("/api/workspaces/switch", { body: { workspaceId: id } });
    qc.clear();
    onNavigate?.();
    router.push("/chat");
    router.refresh();
  };
  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    router.replace("/sign-in");
    router.refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-4">
        <p className="px-3 pb-2 text-[15px] font-bold">{t.brand}</p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-auto sm:h-auto min-h-11 w-full justify-between bg-card px-3 py-1.5 text-start" aria-label={`${t.nav.workspace}: ${active?.name ?? ""}`}>
              <span className="min-w-0">
                <span className="block text-[12px] font-normal text-muted-foreground">{t.nav.workspace}</span>
                <span className="block truncate text-[14px]">{active?.name}</span>
              </span>
              <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
            <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">{t.nav.workspace}</DropdownMenuLabel>
            {session.workspaces.map((w) => (
              <DropdownMenuItem key={w.id} className="min-h-11 sm:min-h-8" onSelect={() => void switchTo(w.id)}>
                <span className={cn("truncate", w.id === session.workspaceId && "font-semibold")}>{w.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 sm:min-h-8" onSelect={() => setNewWs(true)}>
              {t.nav.newWorkspace}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav aria-label={t.nav.workspace} className="mt-4 space-y-0.5 px-3">
        <NavLink href="/chat" label={t.nav.chats} onNavigate={onNavigate} />
        <NavLink href="/agents" label={t.nav.agents} onNavigate={onNavigate} />
        {can(session.role, "providers.view") && <NavLink href="/providers" label={t.nav.providers} onNavigate={onNavigate} />}
        <NavLink href="/settings" label={t.nav.settings} onNavigate={onNavigate} />
      </nav>

      <Separator className="mt-5" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4">
        <ConversationList onNavigate={onNavigate} />
      </div>

      <Separator />
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto sm:h-auto min-h-11 w-full justify-start gap-2 px-3 py-1.5 text-start" aria-label={`${t.nav.account}: ${session.me.name}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{session.me.name}</span>
                <span className="block truncate text-[12px] font-normal text-muted-foreground" dir="ltr">
                  {session.me.email}
                </span>
              </span>
              <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
            <DropdownMenuItem
              className="min-h-11 sm:min-h-8"
              onSelect={() => {
                onNavigate?.();
                router.push("/account");
              }}
            >
              {t.nav.account}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 sm:min-h-8" onSelect={() => void signOut()}>
              {t.auth.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NewWorkspaceDialog open={newWs} onOpenChange={setNewWs} />
    </div>
  );
}

export function Shell({ children, ...session }: SessionInfo & { children: React.ReactNode }) {
  const { t, dir } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <SessionProvider value={session}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-e bg-background md:block">
          <SidebarBody session={session} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-2 md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t.nav.openMenu} aria-expanded={mobileOpen}>
                  <MenuIcon className="size-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              {/* The sheet opens from the reading start edge: right in Persian, left in English. */}
              <SheetContent side={dir === "rtl" ? "right" : "left"} dir={dir} closeLabel={t.nav.closeMenu} className="w-[min(20rem,88vw)] gap-0 p-0">
                <SheetTitle className="sr-only">{t.nav.workspace}</SheetTitle>
                <SheetDescription className="sr-only">{t.nav.workspace}</SheetDescription>
                <SidebarBody session={session} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="text-[15px] font-bold">{t.brand}</span>
          </header>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
