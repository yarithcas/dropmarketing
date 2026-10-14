"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/logo";
import { LanguageSelect } from "@/components/app/language-select";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function MarketingHeader() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/#features", label: t("landing.nav.features") },
    { href: "/#scoring", label: t("landing.nav.scoring") },
    { href: "/pricing", label: t("landing.nav.pricing") },
    { href: "/#faq", label: t("landing.nav.faq") },
  ];
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-bg/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="focus-ring rounded-md">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-fg">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <LanguageSelect compact />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t("auth.login")}
          </Link>
          <Link href="/app" className={buttonVariants({ size: "sm" })} data-testid="cta-demo-header">
            {t("landing.ctaDemo")}
          </Link>
        </div>
        <button className="ml-auto rounded-md p-2 text-muted md:hidden" onClick={() => setOpen((o) => !o)} aria-label={t("nav.openMenu")}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-4 md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block text-sm text-muted">
              {l.label}
            </Link>
          ))}
          <div className="flex items-center gap-2 pt-2">
            <LanguageSelect compact />
            <Link href="/login" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              {t("auth.login")}
            </Link>
            <Link href="/app" className={buttonVariants({ size: "sm" })}>
              {t("landing.ctaDemo")}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function MarketingFooter() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="space-y-3 md:col-span-2">
          <Logo />
          <p className="max-w-sm text-sm text-subtle">{t("landing.footer.tagline")}</p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="label">{t("landing.footer.product")}</div>
          <Link href="/app" className="block text-muted hover:text-fg">
            {t("landing.ctaDemo")}
          </Link>
          <Link href="/pricing" className="block text-muted hover:text-fg">
            {t("landing.nav.pricing")}
          </Link>
          <Link href="/signup" className="block text-muted hover:text-fg">
            {t("auth.signup")}
          </Link>
        </div>
        <div className="space-y-2 text-sm">
          <div className="label">{t("landing.footer.legal")}</div>
          <Link href="/privacy" className="block text-muted hover:text-fg">
            {t("legal.privacyTitle")}
          </Link>
          <Link href="/terms" className="block text-muted hover:text-fg">
            {t("legal.termsTitle")}
          </Link>
        </div>
      </div>
      <div className="border-t border-border/60 py-5 text-center text-xs text-subtle">
        © {new Date().getFullYear()} TrendHunter · {t("landing.footer.disclaimer")}
      </div>
    </footer>
  );
}

export function MarketingShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-h-screen", className)}>
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
