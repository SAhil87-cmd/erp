import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const body = Poppins({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
