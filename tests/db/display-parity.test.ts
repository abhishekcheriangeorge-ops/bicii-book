/**
 * Lists read the tables and name records in TypeScript (src/lib/people.ts,
 * src/lib/bikes.ts); search results come named by staff_search in SQL. A
 * customer or bike must read the same either way, so the TypeScript
 * mirrors are checked against the SQL they copy.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { bikeSubtitle, bikeTitle } from "@/lib/bikes";
import { customerLabel } from "@/lib/people";

import { BIKE, BIKE_SHORT_ID, STAFF } from "../fixtures/ids";
import { asStaff, connect, inTransaction } from "./harness";

let conn: pg.Client;

beforeAll(async () => {
  conn = await connect();
});

const NAME_CASES: Array<
  [string | null, string | null, string | null, string | null, string | null]
> = [
  ["Wei Ming", "Tan", "Tan Wei Ming", "w@example.com", "+65 1"],
  ["Priya", "Ramasamy", null, "p@example.com", null],
  ["Priya", null, null, "p@example.com", null],
  [null, "Ong", null, "d@example.com", null],
  [null, null, null, "d@example.com", "+65 2"],
  [null, null, null, null, "+65 9000 0000"],
  [null, null, null, null, null],
];

describe("display parity between list pages and staff_search", () => {
  it("customerLabel matches private.customer_label", async () => {
    await inTransaction(conn, async (tx) => {
      for (const [first, last, display, email, phone] of NAME_CASES) {
        const { rows } = await tx.query<{ label: string }>(
          "select private.customer_label($1, $2, $3, $4, $5) as label",
          [first, last, display, email, phone],
        );
        expect(
          customerLabel({ firstName: first, lastName: last, displayName: display, email, phone }),
        ).toBe(rows[0].label);
      }
    });
  });

  it("bikeTitle and bikeSubtitle match staff_search titles for every seeded bike", async () => {
    await asStaff(conn, STAFF.admin, async (tx) => {
      const { rows: bikes } = await tx.query<{
        id: string;
        brand: string;
        model: string;
        variant: string | null;
        colour: string | null;
        serial_number: string | null;
        owner_id: string | null;
        first_name: string | null;
        last_name: string | null;
        display_name: string | null;
        email: string | null;
        phone: string | null;
      }>(
        `select b.id, b.brand, b.model, b.variant, b.colour, b.serial_number, c.id as owner_id,
                c.first_name, c.last_name, c.display_name, c.email::text as email, c.phone
           from public.bikes b left join public.customers c on c.id = b.customer_id
          where b.id = any($1)`,
        [Object.values(BIKE)],
      );
      expect(bikes).toHaveLength(Object.keys(BIKE).length);
      for (const bike of bikes) {
        const shortId =
          BIKE_SHORT_ID[
            (Object.keys(BIKE) as Array<keyof typeof BIKE>).find((k) => BIKE[k] === bike.id)!
          ];
        const { rows } = await tx.query<{ id: string; title: string; subtitle: string }>(
          "select id, title, subtitle from public.staff_search($1, array['bike'], 5)",
          [shortId],
        );
        const hit = rows.find((r) => r.id === bike.id)!;
        expect(bikeTitle(bike)).toBe(hit.title);
        expect(
          bikeSubtitle({
            ownerLabel: bike.owner_id
              ? customerLabel({
                  firstName: bike.first_name,
                  lastName: bike.last_name,
                  displayName: bike.display_name,
                  email: bike.email,
                  phone: bike.phone,
                })
              : null,
            colour: bike.colour,
            serialNumber: bike.serial_number,
          }),
        ).toBe(hit.subtitle);
      }
    });
  });
});
