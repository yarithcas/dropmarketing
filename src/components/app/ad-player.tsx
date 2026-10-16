"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Loader2, Pause, Play, PlayCircle, RotateCcw, ScanSearch, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdMedia, Advertisement } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

/**
 * Ad video viewing.
 *
 * - Real ads: only media a connector stored as authorized (HTTPS, provider-returned for display, see
 *   migration 0007) is played, with the browser's native <video> player. Nothing is scraped, proxied or
 *   embedded from an ad library page; without playable media the official library page is linked out.
 * - Demo ads (synthetic dataset): an original animated storyboard generated from the demo ad's own text,
 *   always labelled as a generated demonstration — never presented as an advertiser's creative.
 */

export const videoMedia = (ad: Advertisement): AdMedia[] => (ad.media ?? []).filter((m) => m.type === "video" && m.authorized && m.url.startsWith("https://"));
const imageMedia = (ad: Advertisement): AdMedia[] => (ad.media ?? []).filter((m) => m.type === "image" && m.authorized && m.url.startsWith("https://"));

/** A play affordance is shown for ads the source reports as videos, or that carry playable video media. */
export const isWatchable = (ad: Advertisement) => ad.format === "video" || videoMedia(ad).length > 0;

/** Link to the ad's official library page (never embedded: Meta's Ad Library refuses framing). HTTPS only. */
export function OfficialLibraryLink({ ad, className }: { ad: Advertisement; className?: string }) {
  const { t } = useTranslation();
  if (!ad.snapshotUrl?.startsWith("https://")) return null;
  return (
    <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer nofollow" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), className)} data-testid="official-library-link">
      <ExternalLink /> {t("player.officialLink")}
    </a>
  );
}

function NoMedia({ ad, reason }: { ad: Advertisement; reason: "none" | "error" }) {
  const { t } = useTranslation();
  const link = ad.snapshotUrl?.startsWith("https://");
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-2/60 px-4 py-8 text-center" data-testid="player-fallback">
      {reason === "error" ? <AlertTriangle className="size-6 text-warn" /> : <PlayCircle className="size-6 text-subtle" />}
      <p className="max-w-sm text-sm text-muted">{reason === "error" ? t("player.error") : t("player.noMedia")}</p>
      {link ? <OfficialLibraryLink ad={ad} /> : <p className="text-xs text-subtle">{t("player.noOfficialLink")}</p>}
    </div>
  );
}

/** Native HTML5 player for an authorized video URL: muted by default, keyboard-operable native controls. */
function VideoPlayer({ ad, media }: { ad: Advertisement; media: AdMedia[] }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const current = media[Math.min(index, media.length - 1)];
  useEffect(() => setState("loading"), [current.url]);
  if (state === "error") return <NoMedia ad={ad} reason="error" />;
  return (
    <div className="space-y-2" data-testid="ad-player" data-kind="video">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          key={current.url}
          src={current.url}
          poster={current.posterUrl?.startsWith("https://") ? current.posterUrl : undefined}
          controls
          playsInline
          muted
          preload="metadata"
          controlsList="nodownload"
          aria-label={t("player.videoLabel", { advertiser: ad.advertiser })}
          className="mx-auto max-h-[70vh] w-full bg-black object-contain"
          onLoadedMetadata={() => setState("ready")}
          onCanPlay={() => setState("ready")}
          onError={() => setState("error")}
          data-testid="ad-video"
        />
        {state === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-black/40 text-sm text-white" role="status">
            <Loader2 className="size-4 animate-spin" /> {t("player.loading")}
          </div>
        ) : null}
      </div>
      {media.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("player.videos")}>
          {media.map((m, i) => (
            <button key={m.url} type="button" onClick={() => setIndex(i)} aria-pressed={i === index} className={cn("focus-ring rounded-md border border-border px-2 py-1 text-xs", i === index ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2")}>
              {t("player.videoN", { n: i + 1 })}
            </button>
          ))}
        </div>
      ) : null}
      <MediaSourceLine ad={ad} source={current.source} />
    </div>
  );
}

function MediaSourceLine({ ad, source }: { ad: Advertisement; source: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-subtle">
      <span>{t("player.mediaSource", { source: t(`connectors.names.${source || ad.source.connector}`, { defaultValue: source || ad.source.connector }) })}</span>
      {ad.snapshotUrl?.startsWith("https://") ? (
        <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent hover:underline">
          <ExternalLink className="size-3" /> {t("player.officialLink")}
        </a>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo: generated animated storyboard
// ---------------------------------------------------------------------------

const SCENE_MS = 2200;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** First sentence of the copy (the hook), trimmed for a title card. */
function hookOf(copy: string) {
  const m = /^(.{8,120}?[.!?…])(\s|$)/.exec(copy.trim());
  const s = (m ? m[1] : copy.trim()).trim();
  return s.length > 110 ? `${s.slice(0, 107)}…` : s;
}

interface Scene {
  kind: "hook" | "headline" | "product" | "cta";
  text: string;
  sub?: string;
}

/**
 * Original animated preview for a synthetic demo ad: four title cards (hook, headline, product, call to
 * action) built from the demo ad's own text and colour, ~9 s loop. Pure CSS/SVG, no external media.
 * With prefers-reduced-motion it starts paused and switches cards without movement.
 */
export function DemoVideoPreview({ ad, productName }: { ad: Advertisement; productName?: string | null }) {
  const { t } = useTranslation();
  const reduced = usePrefersReducedMotion();
  const scenes = useMemo<Scene[]>(() => {
    const list: Scene[] = [];
    const hook = hookOf(ad.copy);
    if (hook) list.push({ kind: "hook", text: hook });
    if (ad.headline.trim()) list.push({ kind: "headline", text: ad.headline.trim() });
    list.push({ kind: "product", text: productName?.trim() || ad.headline.trim() || ad.advertiser, sub: ad.advertiser });
    list.push({ kind: "cta", text: t(`cta.${ad.cta}`), sub: ad.landingDomain ?? ad.advertiser });
    return list;
  }, [ad, productName, t]);
  const total = scenes.length * SCENE_MS;
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const started = useRef(false);
  // Autoplay (muted animation, no sound) unless the user prefers reduced motion.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      setElapsed((e) => (e + dt) % total);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const sceneIndex = Math.min(scenes.length - 1, Math.floor(elapsed / SCENE_MS));
  const goTo = useCallback((i: number) => setElapsed((((i % scenes.length) + scenes.length) % scenes.length) * SCENE_MS), [scenes.length]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === " " || e.key === "k" || e.key === "Enter") {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(sceneIndex + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(sceneIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    }
  };
  const pct = Math.round((elapsed / total) * 100);
  const h1 = ad.hue;
  const h2 = (ad.hue + 60) % 360;

  return (
    <div className="space-y-2" data-testid="ad-player" data-kind="demo">
      <div
        className="focus-ring relative mx-auto aspect-[9/16] w-full max-w-[315px] overflow-hidden rounded-xl text-white shadow-lg"
        style={{ background: `linear-gradient(165deg, hsl(${h1} 60% 30%), hsl(${h2} 55% 12%))` }}
        role="region"
        aria-roledescription={t("player.demo.roleDescription")}
        aria-label={t("player.demo.label", { advertiser: ad.advertiser })}
        tabIndex={0}
        onKeyDown={onKey}
        data-testid="demo-video-preview"
        data-state={playing ? "playing" : "paused"}
      >
        {/* Decorative animated shapes (CSS keyframes; neutralised by prefers-reduced-motion). */}
        <svg aria-hidden className={cn("absolute inset-0 size-full opacity-40", playing && !reduced && "th-player-drift")} viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="15" cy="30" r="22" fill={`hsl(${h2} 70% 55% / .35)`} />
          <circle cx="80" cy="120" r="30" fill={`hsl(${h1} 70% 60% / .3)`} />
          <rect x="50" y="20" width="26" height="26" rx="6" fill="hsl(0 0% 100% / .08)" transform="rotate(18 63 33)" />
        </svg>
        <div className="bg-grid absolute inset-0 opacity-20" aria-hidden />

        {/* Always-visible label: generated demonstration, not a real creative. */}
        <div className="absolute inset-x-2 top-2 z-10 flex justify-center">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur" data-testid="demo-video-badge">
            <Sparkles className="size-3" /> {t("player.demo.badge")}
          </span>
        </div>

        <div className="absolute inset-0 flex items-center justify-center px-5 pb-16 pt-10" aria-live="off">
          {scenes.map((s, i) => (
            <div
              key={`${s.kind}-${i}`}
              aria-hidden={i !== sceneIndex}
              className={cn(
                "absolute inset-x-5 flex flex-col items-center text-center transition-all duration-500 motion-reduce:transition-none",
                i === sceneIndex ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-3 scale-95 opacity-0 motion-reduce:translate-y-0 motion-reduce:scale-100",
              )}
            >
              {s.kind === "hook" ? <p className="text-xl font-bold leading-tight drop-shadow">{s.text}</p> : null}
              {s.kind === "headline" ? (
                <>
                  <span className="mb-3 h-1 w-10 rounded-full" style={{ background: `hsl(${h2} 80% 65%)` }} />
                  <p className="text-2xl font-extrabold leading-tight drop-shadow">{s.text}</p>
                </>
              ) : null}
              {s.kind === "product" ? (
                <>
                  <div className={cn("mb-4 grid size-24 place-items-center rounded-2xl border border-white/25 bg-white/10 shadow-xl backdrop-blur", playing && !reduced && i === sceneIndex && "th-player-pop")}>
                    <svg viewBox="0 0 48 48" className="size-14" aria-hidden>
                      <rect x="10" y="14" width="28" height="26" rx="6" fill={`hsl(${h1} 75% 70%)`} />
                      <rect x="16" y="8" width="16" height="8" rx="3" fill={`hsl(${h2} 75% 75%)`} />
                      <circle cx="24" cy="27" r="5" fill="hsl(0 0% 100% / .8)" />
                    </svg>
                  </div>
                  <p className="text-lg font-bold leading-snug">{s.text}</p>
                  {s.sub ? <p className="mt-1 text-xs text-white/70">{s.sub}</p> : null}
                </>
              ) : null}
              {s.kind === "cta" ? (
                <>
                  <span className={cn("rounded-full bg-white px-5 py-2 text-sm font-bold text-black shadow-lg", playing && !reduced && i === sceneIndex && "th-player-pulse")}>{s.text}</span>
                  {s.sub ? <p className="mt-3 text-xs text-white/70">{s.sub}</p> : null}
                </>
              ) : null}
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-6">
          <div className="flex gap-1" role="progressbar" aria-label={t("player.demo.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-testid="demo-video-progress">
            {scenes.map((s, i) => {
              const fill = i < sceneIndex ? 100 : i > sceneIndex ? 0 : ((elapsed - i * SCENE_MS) / SCENE_MS) * 100;
              return (
                <button key={`${s.kind}-${i}`} type="button" onClick={() => goTo(i)} className="focus-ring h-1.5 flex-1 overflow-hidden rounded-full bg-white/25" aria-label={t("player.demo.scene", { n: i + 1, total: scenes.length })} aria-current={i === sceneIndex ? "step" : undefined}>
                  <span className="block h-full bg-white" style={{ width: `${fill}%` }} />
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="focus-ring grid size-8 place-items-center rounded-full bg-white text-black hover:bg-white/90"
              aria-label={playing ? t("player.demo.pause") : t("player.demo.play")}
              aria-pressed={playing}
              data-testid="player-toggle"
              data-autofocus
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
            </button>
            <button type="button" onClick={() => goTo(0)} className="focus-ring grid size-8 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25" aria-label={t("player.demo.restart")}>
              <RotateCcw className="size-3.5" />
            </button>
            <span className="num ml-auto text-[11px] text-white/80" aria-hidden>
              {(elapsed / 1000).toFixed(1)} / {(total / 1000).toFixed(1)} s
            </span>
          </div>
        </div>
      </div>
      <p className="mx-auto max-w-[315px] text-[11px] leading-relaxed text-subtle" data-testid="demo-video-disclaimer">
        {t("player.demo.disclaimer")} {reduced ? t("player.demo.reducedMotion") : null}
      </p>
      <p className="mx-auto max-w-[315px] text-[11px] text-subtle">{t("player.demo.keyboard")}</p>
    </div>
  );
}

/** Best available viewer: authorized video → demo storyboard (demo data only) → authorized image → link out. */
export function AdMediaViewer({ ad, productName }: { ad: Advertisement; productName?: string | null }) {
  const { t } = useTranslation();
  const videos = videoMedia(ad);
  if (videos.length) return <VideoPlayer ad={ad} media={videos} />;
  if (ad.source.kind === "demo") return <DemoVideoPreview ad={ad} productName={productName} />;
  const images = imageMedia(ad);
  if (images.length && ad.format !== "video") {
    return (
      <div className="space-y-2" data-testid="ad-player" data-kind="image">
        {/* Authorized provider image URL (HTTPS), displayed as returned — never re-hosted. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[0].url} alt={t("player.imageAlt", { advertiser: ad.advertiser })} referrerPolicy="no-referrer" loading="lazy" className="mx-auto max-h-[70vh] w-full rounded-lg bg-black object-contain" />
        <MediaSourceLine ad={ad} source={images[0].source} />
      </div>
    );
  }
  return <NoMedia ad={ad} reason="none" />;
}

/** Play affordance over a card preview; opens the creative viewer dialog. */
export function WatchAdButton({ ad, productName, className }: { ad: Advertisement; productName?: string | null; className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("focus-ring group absolute inset-0 flex items-center justify-center", className)} aria-label={t("player.watchAria", { advertiser: ad.advertiser })} data-testid="watch-ad">
        <span className="grid size-14 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/40 backdrop-blur transition group-hover:scale-105 group-hover:bg-black/60 -translate-y-3">
          <Play className="size-6 translate-x-0.5" fill="currentColor" />
        </span>
      </button>
      <Dialog open={open} onClose={close} title={t("player.dialogTitle", { advertiser: ad.advertiser })} description={ad.headline || undefined} size="lg">
        <div className="space-y-4" data-testid="ad-player-dialog">
          <AdMediaViewer ad={ad} productName={productName} />
          <div className="flex justify-end">
            <Link href={`/app/creatives?ad=${ad.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <ScanSearch /> {t("ads.analyze")}
            </Link>
          </div>
        </div>
      </Dialog>
    </>
  );
}
