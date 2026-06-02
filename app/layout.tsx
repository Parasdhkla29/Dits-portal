import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fee Management System – Tehsil Nilokheri",
  description: "District Information Technology Society – Fee Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-gray-50" suppressHydrationWarning>{children}</body>
    </html>
  );
}
