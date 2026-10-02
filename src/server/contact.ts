import type { ShopContact } from "../types.js";

/**
 * The slice of shopify-app-remix's `admin` context the kit needs. Declared as a
 * method so the library's generic `graphql` signature is assignable to it.
 */
export type AdminGraphqlClient = {
  graphql(query: string): Promise<{ json(): Promise<unknown> }>;
};

export const SHOP_CONTACT_QUERY = `#graphql
  query NerdLabsMessagesShopContact {
    shop {
      email
      name
      shopOwnerName
      contactEmail
    }
  }
`;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The merchant's contact email + name from the Admin API.
 * Prefers `contactEmail` (the store's customer-facing/support address the
 * merchant chose) over the account `email`; prefers the owner's personal name
 * over the store name. Never throws — returns empties on any failure.
 */
export async function shopContact(admin: AdminGraphqlClient | null | undefined): Promise<ShopContact> {
  try {
    if (!admin) return { email: "", name: "" };
    const response = await admin.graphql(SHOP_CONTACT_QUERY);
    const payload: unknown = await response.json();
    const shop =
      typeof payload === "object" && payload !== null
        ? (payload as { data?: { shop?: Record<string, unknown> | null } | null }).data?.shop
        : undefined;
    if (!shop || typeof shop !== "object") return { email: "", name: "" };
    return {
      email: str(shop.contactEmail) || str(shop.email),
      name: str(shop.shopOwnerName) || str(shop.name),
    };
  } catch (error) {
    console.error("[nerdlabs-messages] shopContact failed:", error);
    return { email: "", name: "" };
  }
}
