"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ChevronsUpDown, Menu as MenuIcon, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth/client";
import { api } from "@/lib/client/api";
import { can } from "@/lib/workspaces/permissions";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n-provider";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/menu";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { ConversationList } from "./conversation-list";
import { SessionProvider, type SessionInfo } from "./session-context";

function NavLink({ href, label, onNavigate }: { href: string; label: string; onNavigate?: () => void }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        // The start-edge bar marks the current page (a real state), alongside weight and fill.
        "relative flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-[15px] hover:bg-surface-2 active:bg-line sm:min-h-9",
        active && "bg-surface-2 font-semibold before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-ink",
      )}
    >
      {label}
    </Link>
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
    <Dialog open={open} onOpenChange={onOpenChange} title={t.nav.newWorkspace}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t.nav.workspaceName} error={error ?? undefined}>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {t.nav.create}
          </Button>
        </div>
      </form>
    </Dialog>
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
        <Menu
          align="start"
          trigger={
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-start hover:bg-surface-2"
              aria-label={`${t.nav.workspace}: ${active?.name ?? ""}`}
            >
              <span className="min-w-0">
                <span className="block text-[12px] text-muted">{t.nav.workspace}</span>
                <span className="block truncate text-[14px] font-medium">{active?.name}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            </button>
          }
        >
          <MenuLabel>{t.nav.workspace}</MenuLabel>
          {session.workspaces.map((w) => (
            <MenuItem key={w.id} onSelect={() => void switchTo(w.id)}>
              <span className={cn("truncate", w.id === session.workspaceId && "font-semibold")}>{w.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setNewWs(true)}>{t.nav.newWorkspace}</MenuItem>
        </Menu>
      </div>

      <nav aria-label={t.nav.workspace} className="mt-4 space-y-0.5 px-3">
        <NavLink href="/chat" label={t.nav.chats} onNavigate={onNavigate} />
        <NavLink href="/agents" label={t.nav.agents} onNavigate={onNavigate} />
        {can(session.role, "providers.view") && <NavLink href="/providers" label={t.nav.providers} onNavigate={onNavigate} />}
        <NavLink href="/settings" label={t.nav.settings} onNavigate={onNavigate} />
      </nav>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto border-t border-line px-3 pt-4">
        <ConversationList onNavigate={onNavigate} />
      </div>

      <div className="border-t border-line p-3">
        <Menu
          align="start"
          trigger={
            <button
              type="button"
              aria-label={`${t.nav.account}: ${session.me.name}`}
              className="flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-control)] px-3 text-start hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{session.me.name}</span>
                <span className="block truncate text-[12px] text-muted" dir="ltr">
                  {session.me.email}
                </span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            </button>
          }
        >
          <MenuItem
            onSelect={() => {
              onNavigate?.();
              router.push("/account");
            }}
          >
            {t.nav.account}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => void signOut()}>{t.auth.signOut}</MenuItem>
        </Menu>
      </div>
      <NewWorkspaceDialog open={newWs} onOpenChange={setNewWs} />
    </div>
  );
}

export function Shell({ children, ...session }: SessionInfo & { children: React.ReactNode }) {
  const { t, dir } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <SessionProvider value={session}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-e border-line bg-paper md:block">
          <SidebarBody session={session} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-paper px-2 md:hidden">
            <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
              <D.Trigger asChild>
                <button
                  ref={triggerRef}
                  type="button"
                  aria-label={t.nav.openMenu}
                  aria-expanded={mobileOpen}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] hover:bg-surface-2"
                >
                  <MenuIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              </D.Trigger>
              <D.Portal>
                <D.Overlay className="fixed inset-0 z-40 bg-ink/30" />
                <D.Content
                  dir={dir}
                  onCloseAutoFocus={() => triggerRef.current?.focus()}
                  className="fixed inset-y-0 start-0 z-50 w-[min(20rem,88vw)] border-e border-line bg-paper shadow-[0_12px_40px_rgb(0_0_0/0.18)]"
                >
                  <D.Title className="sr-only">{t.nav.workspace}</D.Title>
                  <D.Description className="sr-only">{t.nav.workspace}</D.Description>
                  <D.Close
                    aria-label={t.nav.closeMenu}
                    className="absolute end-2 top-3 inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] hover:bg-surface-2"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </D.Close>
                  <SidebarBody session={session} onNavigate={() => setMobileOpen(false)} />
                </D.Content>
              </D.Portal>
            </D.Root>
            <span className="text-[15px] font-bold">{t.brand}</span>
          </header>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </SessionProvider>
  );
}
