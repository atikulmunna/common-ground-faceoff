import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FeedbackPanel } from "./results-footer";

describe("FeedbackPanel", () => {
  it("asks one question and sends the answer with an optional comment", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<FeedbackPanel onSubmit={onSubmit} saved={false} />);

    const save = screen.getByRole("button", { name: "Save my answer" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const group = screen.getByRole("group", { name: "Did this feel fair to you?" });
    fireEvent.click(screen.getByRole("button", { name: "Somewhat" }));
    expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe("Somewhat");
    fireEvent.change(screen.getByLabelText("Anything to add? (optional)"), { target: { value: "It missed one point." } });
    fireEvent.click(save);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("somewhat", "It missed one point."));
  });
});
