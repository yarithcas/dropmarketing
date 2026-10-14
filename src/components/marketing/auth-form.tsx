"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createBrowserClient } from "@supabase/ssr";
import { Logo } from "@/components/logo";
import { LanguageSelect } from "@/components/app/language-select";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/use-api";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const { t } = useTranslation();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next")?.startsWith("/app") ? sp.get("next")! : "/app";
  const live = Boolean(SUPABASE_URL && SUPABASE_ANON);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => setError(null), [email, password]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!live) {
        await apiFetch("/api/auth/demo-login", { method: "POST", body: JSON.stringify({ name, email }) });
        router.push(next);
        return;
      }
      const sb = createBrowserClient(SUPABASE_URL!, SUPABASE_ANON!);
      if (mode === "signup") {
        const { error: err, data } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: `${location.origin}/auth/callback` } });
        if (err) throw err;
        if (!data.session) {
          setInfo(t("auth.checkEmail"));
          return;
        }
      } else {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message ? (live ? err.message : t("auth.invalidEmail")) : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div className="bg-grid absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden />
      <div className="absolute right-4 top-4">
        <LanguageSelect compact />
      </div>
      <div className="card relative w-full max-w-sm p-6 shadow-2xl">
        <Link href="/" className="mb-6 inline-block">
          <Logo />
        </Link>
        <h1 className="text-xl font-semibold">{mode === "login" ? t("auth.loginTitle") : t("auth.signupTitle")}</h1>
        <p className="mt-1 text-sm text-subtle">{mode === "login" ? t("auth.loginText") : t("auth.signupText")}</p>
        {!live && (
          <div className="mt-4 flex gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">
            <FlaskConical className="size-4 shrink-0" /> {t("auth.demoNotice")}
          </div>
        )}
        <form onSubmit={submit} className="mt-5 space-y-3">
          {(mode === "signup" || !live) && (
            <Field label={t("auth.name")} htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
            </Field>
          )}
          <Field label={t("auth.email")} htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={120} data-testid="auth-email" />
          </Field>
          {live && (
            <Field label={t("auth.password")} htmlFor="password" hint={mode === "signup" ? t("auth.passwordHint") : undefined}>
              <Input id="password" type="password" required minLength={mode === "signup" ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          {info && <p className="text-sm text-good">{info}</p>}
          <Button type="submit" className="w-full" disabled={busy} data-testid="auth-submit">
            {busy && <Loader2 className="animate-spin" />}
            {mode === "login" ? t("auth.login") : t("auth.signup")}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-subtle">
          {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
          <Link href={mode === "login" ? "/signup" : "/login"} className="text-accent hover:underline">
            {mode === "login" ? t("auth.signup") : t("auth.login")}
          </Link>
        </p>
        <p className="mt-3 text-center text-[11px] text-subtle">
          {t("auth.legal")}{" "}
          <Link href="/terms" className="underline">
            {t("legal.termsTitle")}
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="underline">
            {t("legal.privacyTitle")}
          </Link>
        </p>
      </div>
    </div>
  );
}
