import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PerspectiveEditor } from "./perspective-editor";

const BELIEF = "Two office days a week is right for our team.";
const REASONS = "New colleagues learn faster when they can ask in person, and planning goes better face to face.";

function Editor({ hasSubmitted = false, initialText = "", onSubmit = () => {} }: { hasSubmitted?: boolean; initialText?: string; onSubmit?: (text: string, changeMind: string) => void }) {
  const [text, setText] = useState(initialText);
  const [changeMind, setChangeMind] = useState("");
  return (
    <>
      <PerspectiveEditor
        text={text}
        onChange={setText}
        changeMind={changeMind}
        onChangeMindChange={setChangeMind}
        hasSubmitted={hasSubmitted}
        editing={hasSubmitted}
        onEdit={() => {}}
        onCancel={() => {}}
        onSubmit={() => onSubmit(text, changeMind)}
        busy={false}
        deadlinePassed={false}
        removedByModerator={false}
        anonymous={false}
      />
      <output data-testid="text">{text}</output>
    </>
  );
}

describe("PerspectiveEditor", () => {
  it("starts a new perspective as three questions, and joins the first two into the perspective", () => {
    const onSubmit = vi.fn();
    render(<Editor onSubmit={onSubmit} />);

    expect(screen.queryByLabelText("Your perspective")).toBeNull();
    fireEvent.change(screen.getByLabelText("What do you believe?"), { target: { value: BELIEF } });
    fireEvent.change(screen.getByLabelText("Why do you believe it?"), { target: { value: REASONS } });
    fireEvent.change(screen.getByLabelText("What could change your mind? (optional)"), { target: { value: "Data on remote hires." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit your perspective" }));

    expect(onSubmit).toHaveBeenCalledWith(`${BELIEF}\n\n${REASONS}`, "Data on remote hires.");
  });

  it("keeps what was written when switching to free writing", () => {
    render(<Editor />);

    fireEvent.change(screen.getByLabelText("What do you believe?"), { target: { value: BELIEF } });
    fireEvent.change(screen.getByLabelText("Why do you believe it?"), { target: { value: REASONS } });
    fireEvent.click(screen.getByRole("button", { name: "Write freely instead" }));

    expect((screen.getByLabelText("Your perspective") as HTMLTextAreaElement).value).toBe(`${BELIEF}\n\n${REASONS}`);
    expect(screen.queryByLabelText("What do you believe?")).toBeNull();
  });

  it("can go back to the questions while nothing is written", () => {
    render(<Editor />);

    fireEvent.click(screen.getByRole("button", { name: "Write freely instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Answer three questions instead" }));

    expect(screen.queryByLabelText("What do you believe?")).not.toBeNull();
  });

  it("edits a saved perspective as free text", () => {
    render(<Editor hasSubmitted initialText={`${BELIEF}\n\n${REASONS}`} />);

    expect((screen.getByLabelText("Your perspective") as HTMLTextAreaElement).value).toBe(`${BELIEF}\n\n${REASONS}`);
    expect(screen.queryByRole("button", { name: "Answer three questions instead" })).toBeNull();
  });

  it("does not show a reading-ease score", () => {
    render(<Editor />);

    fireEvent.change(screen.getByLabelText("What do you believe?"), { target: { value: BELIEF } });
    expect(screen.queryByText(/to read/i)).toBeNull();
  });
});
