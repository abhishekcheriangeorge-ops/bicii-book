"use client";

import { searchCustomers } from "@/app/(staff)/customers/actions";
import { SearchPicker, type PickerOption } from "@/components/ui/search-picker";

/**
 * Find an active customer by name, phone or email (staff_search; archived
 * customers never appear, since they cannot receive bikes). Wrap in
 * <Field> for its label.
 */
export function CustomerPicker({
  name,
  value,
  onSelect,
  currentId,
  required,
  placeholder = "Search name, phone or email",
}: {
  name?: string;
  value?: PickerOption | null;
  onSelect?: (option: PickerOption | null) => void;
  /** Shown but not choosable (e.g. the bike's current owner). */
  currentId?: string | null;
  required?: boolean;
  placeholder?: string;
}) {
  const search = async (q: string): Promise<PickerOption[]> => {
    const result = await searchCustomers({ q });
    if (!result.ok) throw new Error(result.error);
    return result.data.map((c) => ({
      ...c,
      disabled: c.id === currentId,
      meta: c.id === currentId ? "Current owner" : undefined,
    }));
  };
  return (
    <SearchPicker
      search={search}
      name={name}
      value={value}
      onSelect={onSelect}
      required={required}
      placeholder={placeholder}
      minChars={2}
      debounceMs={250}
      emptyMessage="No active customer matches. Create them under Customers first."
    />
  );
}
