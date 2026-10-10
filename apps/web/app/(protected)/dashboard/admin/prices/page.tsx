import { PricesPageClient } from "@/components/features/admin-usage/prices-page-client";

/**
 * Platform console: the provider price list. Reading needs `Usage:Read`,
 * adding a row needs `Price:Create`; both are enforced by the API.
 */
export default function AdminPricesPage() {
  return <PricesPageClient />;
}
