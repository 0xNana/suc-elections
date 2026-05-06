import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body"
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-heading"
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
        <div className="video-stage" aria-hidden="true">
          <video
            className="video-stage__media"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          >
            <source src="https://www.southshore.edu.gh/videos/hero.mp4" type="video/mp4" />
          </video>
          <div className="video-stage__overlay" />
          <div className="video-stage__glow" />
        </div>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
