import Link from "next/link";
import { AdminDashboard } from "@/components/AdminDashboard";

export const metadata = {
  title: "Lead Pipeline | ASA Scaliq",
};

export default function AdminPage() {
  return (
    <main className="admin-page">
      <Link href="/" className="admin-back">
        ← Back to site
      </Link>
      <AdminDashboard />
    </main>
  );
}
