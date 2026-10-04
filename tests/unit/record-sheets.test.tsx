import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const createCustomer = vi.fn();
vi.mock("@/app/(staff)/customers/actions", () => ({
  createCustomer: (...args: unknown[]) => createCustomer(...args),
  updateCustomer: vi.fn(),
  searchCustomers: vi.fn(),
}));

const createBike = vi.fn();
vi.mock("@/app/(staff)/bikes/actions", () => ({
  createBike: (...args: unknown[]) => createBike(...args),
  updateBike: vi.fn(),
}));

import { BikeSheet } from "@/components/domain/bike-sheet";
import { CustomerSheet } from "@/components/domain/customer-sheet";
import { ToastProvider } from "@/components/ui/toast";

beforeEach(() => {
  push.mockReset();
  createCustomer.mockReset();
  createBike.mockReset();
  createCustomer.mockImplementation(async (_prev: unknown, formData: FormData) => ({
    ok: true,
    data: { id: formData.get("id") },
  }));
  createBike.mockImplementation(async (_prev: unknown, formData: FormData) => ({
    ok: true,
    data: { id: formData.get("id") },
  }));
});

describe("CustomerSheet", () => {
  it("opens the new customer's page by default (Phase 1)", async () => {
    const onOpenChange = vi.fn();
    render(
      <ToastProvider>
        <CustomerSheet open onOpenChange={onOpenChange} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ana" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create customer" }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/customers\//)));
  });

  it("hands a new customer to onCreated instead of navigating (intake)", async () => {
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    render(
      <ToastProvider>
        <CustomerSheet open onOpenChange={onOpenChange} onCreated={onCreated} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Lim" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create customer" }));
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const [created] = onCreated.mock.calls[0];
    expect(created.label).toBe("Ana Lim");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("BikeSheet", () => {
  it("hands a new bike to onCreated with its title instead of navigating (intake)", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ToastProvider>
        <BikeSheet
          open
          onOpenChange={onOpenChange}
          owner={{ id: "00000000-0000-4000-8000-000000000001", label: "Ana Lim" }}
          onCreated={onCreated}
        />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Brand/), { target: { value: "Brompton" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "C Line" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add bike" }));
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0][0].label).toBe("Brompton C Line");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the new bike by default (Phase 1)", async () => {
    render(
      <ToastProvider>
        <BikeSheet
          open
          onOpenChange={vi.fn()}
          owner={{ id: "00000000-0000-4000-8000-000000000001", label: "Ana Lim" }}
        />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Brand/), { target: { value: "Brompton" } });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "C Line" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add bike" }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/bikes\//)));
  });
});
