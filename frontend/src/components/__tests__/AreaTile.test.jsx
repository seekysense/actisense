import { render, screen } from "@testing-library/react";
import { AreaTile } from "../AreaTile.jsx";

const mockArea = {
  id: "kitchen",
  name: "Ager Patris Lounge",
  camera_count: 1,
  signals: [{ signal_id: "smoking", enabled: true, threshold_override: null }],
};

const mockSignals = [
  { id: "smoking", text: "person smoking", priority: 2, default_threshold: 0.52, default_action: "notify", source: "embedder", cooldown_sec: 300 },
];

const mockRange = { from: 480, to: 1080 };

test("AreaTile renders area name", () => {
  render(
    <AreaTile
      area={mockArea}
      events={[]}
      range={mockRange}
      signals={mockSignals}
      onOpenEvent={() => {}}
      onOpenSignal={() => {}}
      signalStates={{}}
    />
  );
  expect(screen.getByText(/Ager Patris Lounge/)).toBeTruthy();
});

test("AreaTile shows Clear badge when no events", () => {
  render(
    <AreaTile
      area={mockArea}
      events={[]}
      range={mockRange}
      signals={mockSignals}
      onOpenEvent={() => {}}
      onOpenSignal={() => {}}
      signalStates={{}}
    />
  );
  expect(screen.getByText("Clear")).toBeTruthy();
});

test("AreaTile counts events in range", () => {
  const events = [
    { id: "e1", area_id: "kitchen", signal_id: "smoking", at: 600, at_str: "10:00", score: 0.7, action: "notify", priority: 2 },
    { id: "e2", area_id: "kitchen", signal_id: "smoking", at: 700, at_str: "11:40", score: 0.65, action: "notify", priority: 2 },
  ];
  render(
    <AreaTile
      area={mockArea}
      events={events}
      range={mockRange}
      signals={mockSignals}
      onOpenEvent={() => {}}
      onOpenSignal={() => {}}
      signalStates={{}}
    />
  );
  expect(screen.getAllByText("2").length).toBeGreaterThan(0);
});
