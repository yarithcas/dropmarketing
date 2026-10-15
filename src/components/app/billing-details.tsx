"use client";

import { useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { errorKey } from "@/lib/client/errors";
import { useSession } from "@/lib/client/session";
import { apiFetch, useApi } from "@/lib/client/use-api";
import { useFormat } from "@/lib/format";

export interface SubscriptionInfo {
  plan: string;
  billing: "stripe" | "demo";
  yearlyAvailable: boolean;
  supportAvailable: boolean;
  status: string | null;
  interval: "month" | "year" | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function useSubscription() {
  return useApi<SubscriptionInfo>("/api/billing/subscription");
}

/** Stripe subscription state as recorded by the verified webhook (live billing only). */
export function SubscriptionStatus({ info }: { info: SubscriptionInfo | null }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (!info || info.billing !== "stripe" || !info.status) return null;
  return (
    <dl className="space-y-1.5 text-sm" data-testid="subscription-status">
      <div className="flex justify-between gap-3">
        <dt className="text-subtle">{t("billing.status")}</dt>
        <dd>
          <Badge tone={info.status === "active" || info.status === "trialing" ? "good" : "warn"}>{t(`billing.statuses.${info.status}`, { defaultValue: info.status })}</Badge>
        </dd>
      </div>
      {info.interval && (
        <div className="flex justify-between gap-3">
          <dt className="text-subtle">{t("billing.interval")}</dt>
          <dd>{info.interval === "year" ? t("pricing.yearly") : t("pricing.monthly")}</dd>
        </div>
      )}
      {info.currentPeriodEnd && (
        <div className="flex justify-between gap-3">
          <dt className="text-subtle">{info.cancelAtPeriodEnd ? t("billing.endsOn") : t("billing.renewsOn")}</dt>
          <dd>{f.date(info.currentPeriodEnd.slice(0, 10))}</dd>
        </div>
      )}
    </dl>
  );
}

const CATEGORIES = ["question", "bug", "billing", "data", "other"] as const;

/** Support request form. Business requests are flagged as priority on the server. */
export function SupportCard({ info }: { info: SubscriptionInfo | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { session } = useSession();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("question");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const available = Boolean(info?.supportAvailable) && session.authenticated;
  const priority = session.entitlements.prioritySupport;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/support", { method: "POST", body: JSON.stringify({ category, subject, message }) });
      toast(t("support.sent"));
      setSubject("");
      setMessage("");
    } catch (err) {
      toast(t(errorKey(err)), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <LifeBuoy className="size-4 text-accent" /> {t("support.title")}
          </span>
        }
        description={priority ? t("support.priorityText") : t("support.standardText")}
        action={priority ? <Badge tone="accent">{t("support.priority")}</Badge> : null}
      />
      <CardBody>
        {!available ? (
          <p className="text-sm text-subtle" data-testid="support-unavailable">
            {t("support.unavailable")}
          </p>
        ) : (
          <form className="grid gap-3 sm:grid-cols-[200px_1fr]" onSubmit={submit}>
            <Field label={t("support.category")} htmlFor="support-category">
              <Select id="support-category" value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`support.categories.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("support.subject")} htmlFor="support-subject">
              <Input id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required />
            </Field>
            <Field label={t("support.message")} htmlFor="support-message" className="sm:col-span-2">
              <Textarea id="support-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} rows={5} required />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || !subject.trim() || !message.trim()}>
                <Send /> {t("support.send")}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
