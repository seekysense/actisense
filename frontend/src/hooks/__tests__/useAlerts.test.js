import { renderHook } from "@testing-library/react";
import { useAlerts } from "../useAlerts.js";

vi.mock("../../api/client.js", () => ({
  api: { getAlerts: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../useWebSocket.js", () => ({
  useWebSocket: () => ({
    status: "disconnected",
    subscribe: () => () => {},
  }),
}));

test("useAlerts initializes with empty array", async () => {
  const { result } = renderHook(() => useAlerts());
  expect(result.current.alerts).toEqual([]);
  expect(["connecting", "disconnected", "connected", "error"]).toContain(result.current.wsStatus);
});
