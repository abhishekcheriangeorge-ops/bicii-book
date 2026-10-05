import "server-only";

import type { IntakeContext } from "@/components/domain/consignment-intake-sheet";
import { canViewSaleCosts, type StaffDTO } from "@/lib/auth/permissions";
import { listLocations, listProductCategories } from "@/lib/domain/inventory";
import { currentCultCommonsRate } from "@/lib/domain/services";
import type { ServerSupabase } from "@/lib/supabase/server";

/**
 * What the Receive item sheet needs, loaded on the server for staff who
 * may receive (manage_consignments): the active locations in sort order
 * with the default, the product categories and, for view_costs only, the
 * Cult Commons rate in force for the yield preview.
 */
export async function loadIntakeContext(
  supabase: ServerSupabase,
  staff: StaffDTO,
): Promise<IntakeContext> {
  const costs = canViewSaleCosts(staff);
  const [locations, categories, rate] = await Promise.all([
    listLocations(supabase),
    listProductCategories(supabase),
    costs ? currentCultCommonsRate(supabase) : Promise.resolve(null),
  ]);
  return {
    locations: locations.locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name })),
    defaultLocationId: locations.defaultLocationId,
    categories,
    canViewSaleCosts: costs,
    ccRate: rate,
  };
}
