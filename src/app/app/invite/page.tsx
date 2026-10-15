"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, FlaskConical, Loader2, MailWarning, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/app/bits";
import { useSwitchWorkspace } from "@/components/app/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { errorKey } from "@/lib/client/errors";
import { useSession } from "@/lib/client/session";
import { ApiError, apiFetch } from "@/lib/client/use-api";
import { useFormat } from "@/lib/format";
import { inviteTokenSchema, type InviteLookup } from "@/lib/team";

/**
 * Invitation landing page (/app/invite?token=...). Signed-out visitors are sent
 * to the login page by the middleware and come back here. The token is posted
 * in a request body, and the server checks it against its stored hash.
 */
function InviteInner() {
  const { t } = useTranslation();
  const f = useFormat();
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const { session, refresh } = useSession();
  const switchTo = useSwitchWorkspace();
  const token = sp.get("token") ?? "";
  const valid = inviteTokenSchema.safeParse({ token }).success;
  const live = session?.mode === "live" && session.authenticated;
  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!live || !valid) return;
    let cancelled = false;
    apiFetch<InviteLookup>("/api/team/invitations/lookup", { method: "POST", body: JSON.stringify({ token }) })
      .then((r) => !cancelled && setInvite(r))
      .catch((e) => !cancelled && setFailure(e instanceof ApiError && e.code === "invite_invalid" ? "invite.invalid" : errorKey(e)));
    return () => {
      cancelled = true;
    };
  }, [live, valid, token]);

  const accept = async () => {
    setBusy(true);
    try {
      // The server creates the membership and makes this workspace active.
      await apiFetch("/api/team/invitations/accept", { method: "POST", body: JSON.stringify({ token }) });
      await refresh();
      toast(t("invite.welcome", { workspace: invite?.workspace ?? "" }));
      router.push("/app");
    } catch (e) {
      toast(t(errorKey(e)), "error");
      setBusy(false);
    }
  };

  const signOut = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    await refresh();
    router.push(`/login?next=${encodeURIComponent(`/app/invite?token=${token}`)}`);
  };

  let body: React.ReactNode;
  if (!session) body = <Skeleton className="h-32" />;
  else if (session.mode === "demo")
    body = (
      <div className="flex gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2.5 text-sm text-warn" data-testid="invite-demo">
        <FlaskConical className="size-4 shrink-0" /> {t("invite.demo")}
      </div>
    );
  else if (!session.authenticated)
    body = (
      <p className="text-sm text-muted">
        {t("errors.codes.unauthenticated")}{" "}
        <Link href={`/login?next=${encodeURIComponent(`/app/invite?token=${token}`)}`} className="text-accent hover:underline">
          {t("auth.login")}
        </Link>
      </p>
    );
  else if (!valid || failure) body = <p className="text-sm text-muted" data-testid="invite-invalid">{t(failure ?? "invite.invalid")}</p>;
  else if (!invite) body = <Skeleton className="h-32" />;
  else {
    const role = t(`team.roles.${invite.role}`);
    body = (
      <div className="space-y-4" data-testid="invite-details">
        <p className="text-sm">{invite.invitedBy ? t("invite.invited", { inviter: invite.invitedBy, workspace: invite.workspace, role }) : t("invite.invitedAnon", { workspace: invite.workspace, role })}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="accent">{invite.workspace}</Badge>
          <Badge>{role}</Badge>
        </div>
        {invite.status === "valid" ? (
          <>
            <p className="text-xs text-subtle">{t("invite.expiresOn", { date: f.dateTime(invite.expiresAt) })}</p>
            <Button onClick={accept} disabled={busy} data-testid="invite-accept">
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} {t("invite.accept")}
            </Button>
          </>
        ) : invite.status === "email_mismatch" ? (
          <div className="space-y-3">
            <p className="flex gap-2 text-sm text-warn">
              <MailWarning className="size-4 shrink-0" /> {t("invite.status.email_mismatch", { email: invite.email, current: session.user?.email ?? "—" })}
            </p>
            <Button variant="secondary" onClick={signOut}>
              {t("invite.switchAccount")}
            </Button>
          </div>
        ) : invite.status === "already_member" ? (
          <div className="space-y-3">
            <p className="flex gap-2 text-sm text-good">
              <CheckCircle2 className="size-4 shrink-0" /> {t("invite.status.already_member")}
            </p>
            <Button
              variant="secondary"
              onClick={async () => {
                const target = session.workspaces.find((w) => w.id === invite.organizationId);
                if (target && target.id !== session.workspace?.id) await switchTo(target.id, target.name);
                router.push("/app");
              }}
            >
              {t("invite.open")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">{t(`invite.status.${invite.status}`)}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t("invite.title")} />
      <Card>
        <CardHeader title={t("invite.cardTitle")} />
        <CardBody className="space-y-4">
          {body}
          <Link href="/app" className="inline-block text-xs text-accent hover:underline">
            {t("invite.backToApp")}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <InviteInner />
    </Suspense>
  );
}
