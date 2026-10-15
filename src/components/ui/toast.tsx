"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

type Tone = "success" | "error" | "info";
interface ToastItem { id: number; message: string; tone: Tone }

const Ctx = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, tone: Tone = "success") => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs, { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {items.map((x) => (
          <div
            key={x.id}
            role={x.tone === "error" ? "alert" : "status"}
            data-testid="toast"
            data-tone={x.tone}
            className={cn("pointer-events-auto flex animate-toast-in items-start gap-2 rounded-lg border bg-surface-3 py-2.5 pl-3 pr-1.5 text-sm shadow-xl", x.tone === "error" ? "border-critical/40" : "border-border")}
          >
            {x.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" /> : x.tone === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-critical" /> : <Info className="mt-0.5 size-4 shrink-0 text-accent" />}
            <span className="flex-1">{x.message}</span>
            <button
              type="button"
              onClick={() => dismiss(x.id)}
              className="focus-ring -my-0.5 rounded p-0.5 text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
