import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/provider";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ToastProvider } from "@/components/ui/toast";
import { NavigationProgress } from "@/components/ui/navigation-progress";
import { serverT } from "@/lib/server/messages";

async function requestLocale() {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  // French is the default; the user's explicit choice is remembered in a cookie.
  return isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = serverT(await requestLocale());
  return {
    title: { default: t("meta.title"), template: "%s · TrendHunter" },
    description: t("meta.description"),
    icons: { icon: "/favicon.svg" },
  };
}

export const viewport: Viewport = { themeColor: "#08080b", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale} className={GeistSans.variable} style={{ ["--font-sans" as string]: "var(--font-geist-sans)" }} suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <script
          // Applies the stored theme before paint to avoid a flash.
          dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('th_theme');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}` }}
        />
        <NavigationProgress />
        <I18nProvider initialLocale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
