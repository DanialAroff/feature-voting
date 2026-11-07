import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { VoteButton } from "./vote-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/requests/7",
}));

function renderButton(props: Partial<Parameters<typeof VoteButton>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VoteButton requestId={7} initial={{ voted: false, voteCount: 3 }} canVote {...props} />
    </QueryClientProvider>,
  );
}

/** A fetch whose response we release by hand, to observe the in-between state. */
function deferredFetch() {
  let resolve!: (res: Response) => void;
  const fetchMock = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
  vi.stubGlobal("fetch", fetchMock);
  const respond = async (status: number, body: unknown) => {
    // TanStack Query calls fetch on a microtask after the click.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => resolve(Response.json(body, { status })));
  };
  return { fetchMock, respond };
}

const button = () => screen.getByRole("button");

beforeEach(() => push.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VoteButton", () => {
  test("updates instantly, then settles on the server's numbers", async () => {
    const { fetchMock, respond } = deferredFetch();
    renderButton();

    fireEvent.click(button());
    // Optimistic: before the server answers.
    expect(button()).toHaveAttribute("aria-pressed", "true");
    expect(button()).toHaveTextContent("4");
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/requests/7/vote", expect.objectContaining({ method: "PUT" })),
    );

    // Someone else voted meanwhile: the server's count wins.
    await respond(200, { voted: true, voteCount: 5 });
    expect(button()).toHaveTextContent("5");
  });

  test("rolls back and explains when the server rejects the vote", async () => {
    const { respond } = deferredFetch();
    renderButton();

    fireEvent.click(button());
    expect(button()).toHaveTextContent("4");
    await respond(500, { error: { code: "INTERNAL", message: "boom" } });

    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(button()).toHaveTextContent("3");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save your vote");
  });

  test("removing a vote sends DELETE", async () => {
    const { fetchMock, respond } = deferredFetch();
    renderButton({ initial: { voted: true, voteCount: 3 } });

    fireEvent.click(button());
    expect(button()).toHaveTextContent("2");
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/requests/7/vote", expect.objectContaining({ method: "DELETE" })),
    );
    await respond(200, { voted: false, voteCount: 2 });
    expect(button()).toHaveAttribute("aria-pressed", "false");
  });

  test("rapid clicks send one request at a time and end on the last intent", async () => {
    // Parallel PUT + DELETE can reach the server in either order (found by the
    // e2e double-click test), so the second request waits for the first.
    const pending: ((res: Response) => void)[] = [];
    const fetchMock = vi.fn(() => new Promise<Response>((r) => pending.push(r)));
    vi.stubGlobal("fetch", fetchMock);
    renderButton();

    fireEvent.click(button()); // vote
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(button()); // unvote while the PUT is in flight
    fireEvent.click(button()); // vote again
    fireEvent.click(button()); // ...and unvote: the last intent is "not voted"
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => pending[0](Response.json({ voted: true, voteCount: 4 })));
    // The server now disagrees with the intent, so exactly one follow-up goes out.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/requests/7/vote", expect.objectContaining({ method: "DELETE" }));
    expect(button()).toHaveAttribute("aria-pressed", "false");

    await act(async () => pending[1](Response.json({ voted: false, voteCount: 3 })));
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(button()).toHaveTextContent("3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("follows a merged request to its target", async () => {
    const { respond } = deferredFetch();
    renderButton();
    fireEvent.click(button());
    await respond(409, { error: { code: "CONFLICT", message: "merged", details: { mergedIntoId: 3 } } });
    expect(push).toHaveBeenCalledWith("/requests/3");
  });

  test("logged-out users get a login link that returns them here", () => {
    renderButton({ canVote: false });
    const link = screen.getByRole("link", { name: /log in to vote \(3 votes\)/i });
    expect(link).toHaveAttribute("href", "/login?next=%2Frequests%2F7");
  });
});
