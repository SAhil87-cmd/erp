import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

const body = Montserrat({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Yashodhan Group | Sales Intelligence ERP",
  description:
    "Yashodhan Group Sales Intelligence ERP — CRM classifications, recovery alerts, pipeline stages, and booking opportunity tiers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${body.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
