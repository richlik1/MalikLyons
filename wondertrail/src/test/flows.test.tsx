import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../App";
import { DemoStoreProvider, STORAGE_KEY } from "../state/DemoStore";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DemoStoreProvider>
        <App />
      </DemoStoreProvider>
    </MemoryRouter>,
  );
}

const ROUTES: [string, RegExp][] = [
  ["/", /less scrolling/i],
  ["/parent", /welcome back/i],
  ["/explore", /mission explorer/i],
  ["/missions/story-detective", /story detective/i],
  ["/missions/story-detective/print", /story detective/i],
  ["/adventure", /ready to explore/i],
  ["/parent/reviews", /review completed missions/i],
  ["/portfolio", /learning portfolio/i],
  ["/settings", /the demo family/i],
  ["/missions/nope", /doesn't go anywhere/i],
];

describe("screens", () => {
  it.each(ROUTES)("%s renders", (path, heading) => {
    renderAt(path);
    expect(screen.getAllByRole("heading", { name: heading }).length).toBeGreaterThan(0);
  });
});

describe("prototype flows", () => {
  it("child completes a mission and parent approval updates the portfolio", async () => {
    const user = userEvent.setup();
    renderAt("/");

    // Hand the device to Maya.
    await user.click(screen.getByRole("button", { name: /try a child's adventure/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /maya/i }));
    expect(await screen.findByRole("heading", { name: /hi maya/i })).toBeInTheDocument();

    // Child cannot reach the parent review screen.
    expect(screen.queryByRole("link", { name: /reviews/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Story Detective" }));
    await user.click(screen.getByRole("button", { name: /start my mission/i }));
    await user.click(screen.getByRole("button", { name: /i finished/i }));

    // Empty reflection shows a clear validation error.
    await user.click(screen.getByRole("button", { name: /send to a grown-up/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/please write/i);

    await user.type(screen.getByLabelText(/which clue/i), "<img src=x onerror=alert(1)> The frown showed she was sad.");
    await user.click(screen.getByRole("radio", { name: /proud/i }));
    await user.click(screen.getByRole("button", { name: /send to a grown-up/i }));
    expect(screen.getByRole("heading", { name: /reflection sent/i })).toBeInTheDocument();

    // Switch back to parent (simulated) and approve.
    await user.click(screen.getByRole("button", { name: /grown-ups/i }));
    await user.click(screen.getByRole("button", { name: /continue as grown-up/i }));
    await user.click(screen.getAllByRole("link", { name: /reviews/i })[0]);
    const card = screen.getByRole("article", { name: /maya: story detective/i });
    // Reflection is rendered as text, not HTML.
    expect(within(card).getByText(/<img src=x/)).toBeInTheDocument();
    expect(card.querySelector("img")).toBeNull();
    await user.click(within(card).getByRole("button", { name: /approve/i }));
    expect(screen.getByText(/new badges?: .*first steps.*word wizard/i)).toBeInTheDocument();

    // Portfolio shows the approved mission.
    await user.click(screen.getAllByRole("link", { name: /portfolio/i })[0]);
    await user.click(screen.getByRole("tab", { name: /maya/i }));
    expect(screen.getByRole("heading", { name: "Story Detective" })).toBeInTheDocument();
    expect(screen.getByText(/finding clues in a text/i)).toBeInTheDocument();

    // Progress persists for a refresh.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).achievements.some((a: { childId: string }) => a.childId === "child-maya")).toBe(true);
  });

  it("parent-only screens are blocked in child mode", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...JSON.parse(JSON.stringify((await import("../state/demoReducer")).initialState())), mode: "child" }));
    renderAt("/parent/reviews");
    expect(screen.getByRole("heading", { name: /grown-ups only/i })).toBeInTheDocument();
  });

  it("explorer filters missions", async () => {
    const user = userEvent.setup();
    renderAt("/explore");
    expect(screen.getByText("5 missions")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /ages 11–12/i }));
    expect(screen.getByText("1 mission")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Design a Playground" })).toBeInTheDocument();
  });

  it("out-of-band mission cannot be started", async () => {
    const user = userEvent.setup();
    renderAt("/missions/design-a-playground");
    await user.selectOptions(screen.getByLabelText(/who is doing/i), "child-maya");
    expect(screen.getByText(/not recommended/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start for maya/i })).not.toBeInTheDocument();
  });
});
