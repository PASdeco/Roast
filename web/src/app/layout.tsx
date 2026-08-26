import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const sora = Sora({ subsets: ["latin"], variable: "--font-display" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: {
    default: "Roast My X — The jury is watching",
    template: "%s | Roast My X",
  },
  description:
    "Five independent GenLayer judges evaluate your X profile, roast it, and hand you a practical thesis on what to fix. Zero mercy. No cap.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${sora.variable} ${jetbrains.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
