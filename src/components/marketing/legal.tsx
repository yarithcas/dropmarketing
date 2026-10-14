"use client";

import { useTranslation } from "react-i18next";
import { MarketingShell } from "./chrome";

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const { t } = useTranslation();
  const sections = t(`legal.${kind}.sections`, { returnObjects: true }) as { title: string; body: string }[];
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t(`legal.${kind}Title`)}</h1>
        <p className="mt-2 text-sm text-subtle">{t("legal.updated")}</p>
        <p className="mt-6 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">{t("legal.template")}</p>
        <div className="mt-8 space-y-6">
          {Array.isArray(sections) &&
            sections.map((s) => (
              <section key={s.title}>
                <h2 className="text-base font-semibold">{s.title}</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{s.body}</p>
              </section>
            ))}
        </div>
      </article>
    </MarketingShell>
  );
}
