import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "unauthenticated" as string, role: undefined as string | undefined }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: auth.role ? { user: { id: "u1", role: auth.role } } : null, status: auth.status }),
  signOut: vi.fn(),
}));
vi.mock("../../lib-api", () => ({ apiGet: vi.fn().mockRejectedValue(new Error("no")), apiPost: vi.fn() }));

import AdminDashboardPage from "./page";

describe("Administration page", () => {
  it("asks a signed-out visitor to sign in instead of showing the setup form", () => {
    auth.status = "unauthenticated";
    auth.role = undefined;
    render(<AdminDashboardPage />);

    expect(screen.getByText("Sign in to open Administration.")).toBeTruthy();
    expect(screen.queryByLabelText("Setup code")).toBeNull();
  });

  it("offers setup to a signed-in person who is not an admin", () => {
    auth.status = "authenticated";
    auth.role = "individual_user";
    render(<AdminDashboardPage />);

    expect(screen.getByLabelText("Setup code")).toBeTruthy();
  });
});
