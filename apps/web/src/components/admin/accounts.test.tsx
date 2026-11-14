import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../../lib-api", () => ({ apiPost: api.post }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { ChangePasswordForm } from "../change-password-form";
import { AdminSetupForm } from "./admin-setup-form";
import { CreateAccountForm } from "./create-account-form";

beforeEach(() => {
  api.post.mockReset();
});

describe("CreateAccountForm", () => {
  it("shows the temporary password once, with sign-in details to send", async () => {
    api.post.mockResolvedValue({ data: { account: { email: "val@example.test", displayName: "Val" }, temporaryPassword: "Tmp-pass-123Aa7!" } });
    render(<CreateAccountForm />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Val" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "val@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.queryByText(/Val can sign in now/)).not.toBeNull());
    expect(api.post).toHaveBeenCalledWith("/admin/accounts", { email: "val@example.test", displayName: "Val" });
    expect(screen.getByText(/Temporary password: Tmp-pass-123Aa7!/)).toBeTruthy();
  });

  it("says why when the account cannot be created", async () => {
    api.post.mockRejectedValue(new Error("This person can already sign in. They can change their password from their profile."));
    render(<CreateAccountForm />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Val" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "val@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.queryByText(/can already sign in/)).not.toBeNull());
  });
});

describe("ChangePasswordForm", () => {
  it("checks the two new passwords match before sending", async () => {
    render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "Temporary9!pass" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "MyOwn9!password" } });
    fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "MyOwn9!passwrod" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.queryByText("The new passwords do not match.")).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("changes the password and tells the page", async () => {
    api.post.mockResolvedValue({ data: { changed: true } });
    const onChanged = vi.fn();
    render(<ChangePasswordForm onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "Temporary9!pass" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "MyOwn9!password" } });
    fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "MyOwn9!password" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(screen.queryByText("Password changed.")).not.toBeNull());
    expect(api.post).toHaveBeenCalledWith("/profile/password", { currentPassword: "Temporary9!pass", newPassword: "MyOwn9!password" });
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("AdminSetupForm", () => {
  function fill(confirm = "Admin-pass-2026!") {
    fireEvent.change(screen.getByLabelText("Setup code"), { target: { value: "ABCD-EF01-2345-6789" } });
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Munna" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Me@Example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Admin-pass-2026!" } });
    fireEvent.change(screen.getByLabelText("Password again"), { target: { value: confirm } });
  }

  it("creates the administrator account with the code and points to sign-in", async () => {
    api.post.mockResolvedValue({ data: { organizationId: "org-1" } });
    render(<AdminSetupForm />);

    fill();
    fireEvent.click(screen.getByRole("button", { name: "Become administrator" }));

    await waitFor(() => expect(screen.queryByText("You are the administrator now.")).not.toBeNull());
    expect(api.post).toHaveBeenCalledWith("/admin-setup/claim", {
      code: "ABCD-EF01-2345-6789",
      displayName: "Munna",
      email: "Me@Example.test",
      password: "Admin-pass-2026!",
      organizationName: "Common Ground",
    });
    expect(screen.getByText(/Sign in as me@example.test/)).toBeTruthy();
  });

  it("checks the two passwords match before sending", () => {
    render(<AdminSetupForm />);

    fill("Admin-pass-2027!");
    fireEvent.click(screen.getByRole("button", { name: "Become administrator" }));

    expect(screen.queryByText("The passwords do not match.")).not.toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});
