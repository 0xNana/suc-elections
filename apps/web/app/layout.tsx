import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";

import { AmbientVideoStage } from "../components/ambient-video-stage";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap"
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap"
});

export const metadata: Metadata = {
  title: "SouthShore University College SRC Electronic Voting System",
  description: "SouthShore University College SRC Electronic Voting System.",
  icons: {
    icon: "https://www.southshore.edu.gh/favicon-32x32.png",
    shortcut: "https://www.southshore.edu.gh/favicon-32x32.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${playfair.variable} min-h-screen bg-cream text-ink`}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AmbientVideoStage />
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
