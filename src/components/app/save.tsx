"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Eye, EyeOff, Lock, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useSession } from "@/lib/client/session";
import { useWorkspace } from "@/lib/client/workspace";
import type { ItemType } from "@/lib/workspace";
import { cn } from "@/lib/cn";

export function SaveButton({ type, refId, label, size = "sm", variant = "secondary", iconOnly = false, preferSwipe = false }: { type: ItemType; refId: string; label: string; size?: "sm" | "md" | "icon-sm"; variant?: "secondary" | "ghost" | "primary"; iconOnly?: boolean; preferSwipe?: boolean }) {
  const { t } = useTranslation();
  const { isSaved } = useWorkspace();
  const [open, setOpen] = useState(false);
  const saved = isSaved(type, refId);
  return (
    <>
      <Button
        size={iconOnly ? "icon-sm" : size}
        variant={variant}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={saved ? t("collections.saved") : t("collections.save")}
        data-testid="save-button"
      >
        {saved ? <BookmarkCheck className="text-accent" /> : <Bookmark />}
        {!iconOnly && (saved ? t("collections.saved") : t("collections.save"))}
      </Button>
      {open && <SaveDialog type={type} refId={refId} label={label} preferSwipe={preferSwipe} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveDialog({ type, refId, label, onClose, preferSwipe }: { type: ItemType; refId: string; label: string; onClose: () => void; preferSwipe: boolean }) {
  const { t } = useTranslation();
  const { workspace, dispatch } = useWorkspace();
  const swipe = workspace.collections.find((c) => c.kind === "swipe");
  const [selected, setSelected] = useState<string>((preferSwipe && swipe?.id) || workspace.collections[0]?.id || "");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!newName.trim()) return;
    const ok = await dispatch({ op: "collection.create", name: newName.trim(), description: "", kind: "standard" });
    if (ok) setNewName("");
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    const ok = await dispatch(
      { op: "item.add", collectionId: selected, type, refId, label, note, tags: tags.split(",").map((s) => s.trim()).filter(Boolean) },
      t("collections.savedTo", { name: workspace.collections.find((c) => c.id === selected)?.name ?? "" }),
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("collections.saveTitle")}
      description={label}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={!selected} loading={busy} disabledReason={t("collections.chooseCollection")} data-testid="confirm-save">
            {t("collections.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted">{t("collections.chooseCollection")}</div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {workspace.collections.map((c) => {
              const already = c.items.some((i) => i.type === type && i.refId === refId);
              return (
                <label key={c.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-150", already ? "cursor-not-allowed opacity-60" : "cursor-pointer active:bg-surface-3", selected === c.id ? "border-accent/50 bg-accent/10" : "border-border", !already && selected !== c.id && "hover:border-muted/40 hover:bg-surface-2")} title={already ? t("collections.alreadyIn") : undefined}>
                  <input type="radio" name="collection" className="accent-[rgb(var(--accent))]" checked={selected === c.id} onChange={() => setSelected(c.id)} disabled={already} />
                  <span className="flex-1 truncate">{c.kind === "swipe" ? t("collections.swipeFile") : c.name}</span>
                  <span className="text-xs text-subtle">{already ? t("collections.alreadyIn") : c.items.length}</span>
                </label>
              );
            })}
          </div>
          <div className="flex gap-2 pt-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("collections.newPlaceholder")} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), create())} />
            <Button variant="secondary" onClick={create} disabled={!newName.trim()} disabledReason={t("collections.newPlaceholder")}>
              <Plus /> {t("common.create")}
            </Button>
          </div>
        </div>
        <Field label={t("collections.note")}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t("collections.notePlaceholder")} />
        </Field>
        <Field label={t("collections.tags")} hint={t("collections.tagsHint")}>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t("collections.tagsPlaceholder")} />
        </Field>
      </div>
    </Dialog>
  );
}

export function WatchButton({ type, refId, label, size = "sm" }: { type: "product" | "store" | "category"; refId: string; label: string; size?: "sm" | "md" }) {
  const { t } = useTranslation();
  const { watchId, dispatch } = useWorkspace();
  const { session } = useSession();
  const id = watchId(type, refId);
  // Watchlists are a Pro feature; existing entries can still be removed after a downgrade.
  if (!id && session && !session.entitlements.watchlists)
    return (
      <Link href="/app/settings?tab=billing" className={buttonVariants({ size, variant: "secondary" })} title={t("watchlist.locked")} data-testid="watch-locked" onClick={(e) => e.stopPropagation()}>
        <Lock /> {t("watchlist.watch")}
      </Link>
    );
  return (
    <Button
      size={size}
      variant="secondary"
      onClick={() => (id ? dispatch({ op: "watch.remove", id }, t("watchlist.removed")) : dispatch({ op: "watch.add", type, refId, label }, t("watchlist.added")))}
      data-testid="watch-button"
    >
      {id ? <EyeOff /> : <Eye />}
      {id ? t("watchlist.unwatch") : t("watchlist.watch")}
    </Button>
  );
}
