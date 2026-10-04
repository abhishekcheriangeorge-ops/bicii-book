import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Same faces and setup as the public site (bicii src/app/layout.tsx).
// No `weight`: that pulls the variable font, one file covering the axis.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s · BICII Admin",
    default: "BICII Admin",
  },
  description: "BICII workshop, inventory and operations.",
  applicationName: "BICII Admin",
  // Staff app: keep it out of search engines
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbfaf7",
  // Lets bottom sheets and the tab bar sit in the iPhone safe area
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-SG"
      // Smooth in-page anchor jumps, instant route changes (Next 16 no longer
      // overrides scroll-behavior on navigation unless asked to)
      data-scroll-behavior="smooth"
      className={`${archivo.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
