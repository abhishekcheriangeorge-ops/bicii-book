"use server";

import { refresh } from "next/cache";

import { ActionError, staffAction } from "@/lib/actions";
import { canRecordRefund, hasPermission } from "@/lib/auth/permissions";
import { staffSearch } from "@/lib/domain/search";
import {
  describeRun,
  dismissJob,
  linkCustomer,
  linkVariant,
  retryJob,
  saveShopifySettings,
  type RunReport,
} from "@/lib/domain/shopify";
import { afterCommit } from "@/lib/integrations/shopify/after-commit";
import { defaultDeps } from "@/lib/integrations/shopify/deps";
import { runJobById } from "@/lib/integrations/shopify/queue";
import {
  dismissJobSchema,
  jobIdSchema,
  linkCustomerSchema,
  linkVariantSchema,
  searchProductsSchema,
  shopifySettingsSchema,
} from "@/lib/shopify-forms";

/**
 * Shopify administration (SPEC §17, §26; PLAN D84, D86, D87, D89;
 * src/lib/domain/shopify.ts). Each goes through one domain function; the
 * RPCs check again:
 *
 *   retryJobAction              admins; a manage_inventory holder may retry
 *                               a product-sync job, an admin or a manager
 *                               a refund's job (D94; retry_integration_job
 *                               refuses anyone else with 42501)
 *   dismissJobAction            admins; managers a refund's job (D94; the
 *                               RPC refuses them any other); reason required
 *   linkVariantAction           admins, reason required; then retries the job
 *   linkCustomerAction          admins, reason required (never by email)
 *   saveShopifySettingsAction   admins; a reason when test orders change
 *   searchProductsForLinkAction admins (the Link sheet's product picker)
 *
 * After a retry the action runs exactly the job the RPC returned
 * (runJobById with the service-role deps, D86) and reports its new state.
 * That run is best effort (afterCommit): if it cannot happen, the action
 * still succeeds with "Retry queued" and the queue runs the job.
 */

/** Queue a job again now and run it; the toast says what happened. */
export const retryJobAction = staffAction(
  jobIdSchema,
  { name: "shopify.retry_job" },
  async ({ jobId }, { supabase, staff, correlationId, log }): Promise<RunReport> => {
    // Admins have every permission; manage_inventory alone may only retry
    // product syncs, and an admin or a manager refunds (D94), which the RPC
    // enforces.
    if (!hasPermission(staff, "manage_inventory") && !canRecordRefund(staff)) {
      throw new ActionError("Only an admin can retry this.");
    }
    // Committed here; the run only speeds it up (D87).
    const job = await retryJob(supabase, jobId);
    const report = await afterCommit(
      "run the retried job",
      log,
      async () => describeRun(supabase, job, await runJobById(job.id, defaultDeps(correlationId))),
      await describeRun(supabase, job, null),
    );
    refresh();
    return report;
  },
);

/** Close a job with a reason; an order's waiting refunds are closed too. */
export const dismissJobAction = staffAction(
  dismissJobSchema,
  { name: "shopify.dismiss_job", roles: ["admin", "manager"] },
  async ({ jobId, reason }, { supabase }) => {
    await dismissJob(supabase, jobId, reason);
    refresh();
    return null;
  },
);

/** Link the failing line's Shopify variant to a BICII product, then retry the order. */
export const linkVariantAction = staffAction(
  linkVariantSchema,
  { name: "shopify.link_variant", admin: true },
  async (input, { supabase, correlationId, log }): Promise<RunReport> => {
    await linkVariant(supabase, {
      productId: input.productId,
      productGid: input.shopifyProductGid,
      variantGid: input.shopifyVariantGid,
      reason: input.reason,
    });
    // Both committed here; the run only speeds it up (D87).
    const job = await retryJob(supabase, input.jobId);
    const report = await afterCommit(
      "run the linked job",
      log,
      async () => describeRun(supabase, job, await runJobById(job.id, defaultDeps(correlationId))),
      await describeRun(supabase, job, null),
    );
    refresh();
    return report;
  },
);

/** Link an order's Shopify customer to a BICII customer (applies to later orders, D86). */
export const linkCustomerAction = staffAction(
  linkCustomerSchema,
  { name: "shopify.link_customer", admin: true },
  async ({ customerId, shopifyCustomerGid, reason }, { supabase }) => {
    const result = await linkCustomer(supabase, {
      customerId,
      shopifyCustomerId: shopifyCustomerGid,
      reason,
    });
    refresh();
    return result;
  },
);

/** Save the online location, storefront address and the test-order switch. */
export const saveShopifySettingsAction = staffAction(
  shopifySettingsSchema,
  { name: "shopify.save_settings", admin: true },
  async (input, { supabase }) => {
    const settings = await saveShopifySettings(supabase, input);
    refresh();
    return settings;
  },
);

/** Products for the Link sheet's picker (staff_search, products only). */
export const searchProductsForLinkAction = staffAction(
  searchProductsSchema,
  { name: "shopify.search_products", admin: true },
  async ({ q }, { supabase }) => {
    if (!q) return [];
    const { items } = await staffSearch(supabase, q, { kinds: ["product"], limit: 20 });
    return items.map((h) => ({
      id: h.id,
      label: h.title,
      description: h.subtitle ?? undefined,
      meta: h.shortId ?? undefined,
    }));
  },
);
