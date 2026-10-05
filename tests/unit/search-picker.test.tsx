import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Field } from "@/components/ui/field";
import { SearchPicker, type PickerOption } from "@/components/ui/search-picker";

const parts: PickerOption[] = [
  { id: "p1", label: "Chain 12-speed", meta: "4 in stock" },
  { id: "p2", label: "Chainring 50t", meta: "1 in stock" },
  { id: "p3", label: "Chain checker", meta: "0 in stock", disabled: true },
  { id: "p4", label: "Chain lube", meta: "9 in stock" },
];

function setup(props: Partial<Parameters<typeof SearchPicker>[0]> = {}) {
  const search = vi.fn(async (q: string) =>
    parts.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())),
  );
  const onSelect = vi.fn();
  render(
    <form data-testid="form">
      <Field label="Part">
        <SearchPicker
          search={search}
          onSelect={onSelect}
          name="product_id"
          debounceMs={200}
          {...props}
        />
      </Field>
    </form>,
  );
  const input = screen.getByRole("combobox", { name: "Part" });
  return { search, onSelect, input };
}

async function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  // Let the debounce elapse and the search promise resolve
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

const key = (el: HTMLElement, k: string) => fireEvent.keyDown(el, { key: k });

describe("SearchPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a labelled combobox that starts collapsed", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("debounces: one search per pause in typing", async () => {
    const { input, search } = setup();
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.change(input, { target: { value: "ch" } });
    fireEvent.change(input, { target: { value: "cha" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("cha");
  });

  it("opens with results and highlights the first enabled option", async () => {
    const { input } = setup();
    await type(input, "chain");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  });

  it("moves with arrow keys, skipping disabled options and wrapping", async () => {
    const { input } = setup();
    await type(input, "chain");
    const options = screen.getAllByRole("option");
    const activeId = () => input.getAttribute("aria-activedescendant");

    key(input, "ArrowDown");
    expect(activeId()).toBe(options[1].id);
    key(input, "ArrowDown"); // options[2] is disabled
    expect(activeId()).toBe(options[3].id);
    key(input, "ArrowDown"); // wraps
    expect(activeId()).toBe(options[0].id);
    key(input, "ArrowUp"); // wraps backwards
    expect(activeId()).toBe(options[3].id);
    expect(options[3]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("selects with Enter, closes, shows the label and fills the hidden input", async () => {
    const { input, onSelect } = setup();
    await type(input, "chain");
    key(input, "ArrowDown");
    key(input, "Enter");
    expect(onSelect).toHaveBeenCalledWith(parts[1]);
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("Chainring 50t");
    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(new FormData(form).get("product_id")).toBe("p2");
  });

  it("Escape closes the list, then clears the query", async () => {
    const { input } = setup();
    await type(input, "chain");
    key(input, "Escape");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("chain");
    key(input, "Escape");
    expect(input).toHaveValue("");
  });

  it("ArrowDown reopens a closed list", async () => {
    const { input } = setup();
    await type(input, "chain");
    key(input, "Escape");
    key(input, "ArrowDown");
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("does not select a disabled option on click", async () => {
    const { input, onSelect } = setup();
    await type(input, "checker");
    fireEvent.click(screen.getByRole("option", { name: /Chain checker/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects on click", async () => {
    const { input, onSelect } = setup();
    await type(input, "lube");
    fireEvent.click(screen.getByRole("option", { name: /Chain lube/ }));
    expect(onSelect).toHaveBeenCalledWith(parts[3]);
  });

  it("says so when nothing matches", async () => {
    const { input } = setup({ emptyMessage: "No parts match" });
    await type(input, "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No parts match")).toBeInTheDocument();
  });

  it("ignores a slow response for an older query", async () => {
    const resolvers: Record<string, (v: PickerOption[]) => void> = {};
    const search = vi.fn(
      (q: string) => new Promise<PickerOption[]>((resolve) => (resolvers[q] = resolve)),
    );
    const { input } = setup({ search });
    fireEvent.change(input, { target: { value: "chain" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    fireEvent.change(input, { target: { value: "lube" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      resolvers.lube([parts[3]]);
      resolvers.chain(parts);
    });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Chain lube");
  });

  it("shows a search error inline", async () => {
    const search = vi.fn(async () => {
      throw new Error("Search is unavailable");
    });
    const { input } = setup({ search });
    await type(input, "chain");
    expect(screen.getByText("Search is unavailable")).toBeInTheDocument();
  });

  it("reaches the action row with the arrow keys and runs it with Enter", async () => {
    const create = vi.fn();
    const { input, onSelect } = setup({
      action: { label: (q) => `Create “${q}”`, onSelect: create },
    });
    await type(input, "lube");
    const options = screen.getAllByRole("option");
    expect(options.at(-1)).toHaveTextContent("Create “lube”");
    key(input, "ArrowDown"); // past "Chain lube" to the action row
    expect(input).toHaveAttribute("aria-activedescendant", options.at(-1)!.id);
    key(input, "Enter");
    expect(create).toHaveBeenCalledWith("lube");
    expect(onSelect).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("offers the action row when nothing matches", async () => {
    const create = vi.fn();
    const { input } = setup({ action: { label: () => "Create new", onSelect: create } });
    await type(input, "zzz");
    key(input, "ArrowDown");
    key(input, "Enter");
    expect(create).toHaveBeenCalledWith("zzz");
  });

  async function selectLube(input: HTMLElement) {
    await type(input, "lube");
    key(input, "Enter");
    expect(input).toHaveValue("Chain lube");
  }

  it("clears an optional selection with the clear button", async () => {
    const { input, onSelect } = setup();
    await selectLube(input);
    fireEvent.click(screen.getByRole("button", { name: "Clear Chain lube" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue("");
    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(new FormData(form).get("product_id")).toBe("");
  });

  it("clears an optional selection when the field is emptied and left", async () => {
    const { input, onSelect } = setup();
    await selectLube(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue("");
  });

  it("clears an optional selection with Escape on an empty, closed field", async () => {
    const { input, onSelect } = setup();
    await selectLube(input);
    key(input, "Escape");
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(input).toHaveValue("");
  });

  it("keeps a required selection: no clear button, and leaving an empty field restores it", async () => {
    const { input, onSelect } = setup({ required: true });
    await selectLube(input);
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onSelect).not.toHaveBeenCalledWith(null);
    expect(input).toHaveValue("Chain lube");
  });
});
