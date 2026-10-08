import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AppProvider } from "@/context/AppProvider";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Airbnb · Vacation rentals, cabins, beach houses & more",
  description: "An Airbnb clone built with Next.js, FastAPI and SQLite.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <AppProvider>
          <Suspense fallback={<div className="h-20 border-b border-line" />}>
            <Header />
          </Suspense>
          <main className="flex-1">{children}</main>
          <Footer />
        </AppProvider>
      </body>
    </html>
  );
}
