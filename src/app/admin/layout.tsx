import type { Metadata } from "next";

/**
 * The admin console is an operator surface, not a product page: keep it out of
 * search indexes and crawlers so ordinary visitors never discover it.
 */
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
