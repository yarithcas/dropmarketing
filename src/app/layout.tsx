import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/provider";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "TrendHunter — E-commerce intelligence", template: "%s · TrendHunter" },
  description: "Product research, ad intelligence, trends and competitor analysis for e-commerce teams.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#08080b", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  // French is the default; the user's explicit choice is remembered in a cookie.
  const locale = isLocale(fromCookie) ? fromCookie : DEFAULT_LOCALE;
  return (
    <html lang={locale} className={GeistSans.variable} style={{ ["--font-sans" as string]: "var(--font-geist-sans)" }} suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <script
          // Applies the stored theme before paint to avoid a flash.
          dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('th_theme');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}` }}
        />
        <I18nProvider initialLocale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
