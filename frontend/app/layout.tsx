import type { Metadata, Viewport } from "next";
import { Geist, Inter } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import { Toaster } from "@/components/ui";
import { SettingsProvider } from "@/lib/settings";
import { WorkspaceProvider } from "@/lib/workspace";
import "./globals.css";

// next/font self-hosts at build time: no requests to Google at runtime.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const heading = Geist({ subsets: ["latin"], variable: "--font-heading", display: "swap" });

export const metadata: Metadata = { title: "Envoy — Model UN Workspace", description: "Private, local-first AI workspace for Model UN delegates." };
export const viewport: Viewport = { themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#111110" }, { color: "#f7f6f3" }] };

// Applies the cached theme before first paint to avoid a light/dark flash.
const noFlash = `try{var s=JSON.parse(localStorage.getItem('envoy-theme')||'{}'),t=s.theme||'system';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var e=document.documentElement;e.dataset.theme=t;e.dataset.dark=String(t==='dark'||t==='midnight');e.dataset.accent=s.accent||'indigo';if(s.font_scale)e.style.fontSize=16*s.font_scale+'px'}catch(_){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${heading.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body className="min-h-dvh bg-bg text-fg">
        <WorkspaceProvider>
        <SettingsProvider>
          <div className="flex min-h-dvh flex-col md:flex-row">
            <Sidebar />
            <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">{children}</main>
          </div>
          <Toaster />
        </SettingsProvider>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
