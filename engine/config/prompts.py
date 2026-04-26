"""Catalogo prompt per LLM Vision escalation, indicizzato per llm_prompt_key."""
from __future__ import annotations

PROMPT_CATALOG: dict[str, str] = {
    "person_down": """Analyze these video frames carefully.
Determine whether a person has collapsed or fallen and is lying motionless on the floor.

Confirm TRUE only if ALL of the following are visible:
1. A person is lying flat or slumped on the floor (horizontal body position).
2. The person appears motionless — not moving, not getting up.
3. The posture is consistent with a fall or medical emergency, NOT with normal floor activity.

Do NOT confirm if:
- The person is standing, walking, or moving in any direction.
- The person is bending forward, crouching, or leaning (e.g. mopping, cleaning, picking something up).
- The person is seated on a chair, bench, or sofa.
- The body is upright or partially upright.
- The scene shows a cleaning worker with a mop or broom.

Answer in JSON: {"confirmed": true/false, "description": "describe body position and movement observed", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "smoking_context": """Analyze these video frames.
Is there a person actively smoking — holding a lit cigarette, cigar, or pipe between their fingers or lips?
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "fire_smoke_context": """Analyze these video frames carefully.
Is there visible fire, flames, or thick smoke present in the scene? Do NOT confirm for steam, normal lighting, or cooking vapors.
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "cabinet_context": """Analyze these video frames from a hotel lounge bar area.
Determine whether the storage cabinet (bar cabinet or service locker in the background) is clearly and fully open, with its door(s) visibly swung open and interior shelves or contents exposed.
Confirm TRUE only if: the cabinet door is unmistakably open AND either a person is actively accessing it or it is left unattended while open.
Do NOT confirm if: the cabinet appears closed or only slightly ajar, the door is partially visible but its state is unclear, or it is a different piece of furniture (fridge, display case, window).
Answer in JSON: {"confirmed": true/false, "description": "brief description of what is visible", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "unattended_bag": """Analyze these video frames.
Is there a bag, suitcase, or backpack left on the floor or a surface with no person standing near it or tending to it?
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "unattended_bag_entrance": """Analyze these video frames from a hotel entrance area.
Determine whether there is an unattended piece of luggage — a suitcase, trolley, backpack, duffel bag, or travel bag — left alone with no person nearby.

Confirm TRUE only if ALL of the following conditions are met:
1. A clearly identifiable piece of luggage is visible (suitcase with wheels, trolley, backpack, travel bag — NOT a small purse, shopping bag, or decorative item).
2. No human figure is standing, sitting, or crouching within approximately one meter of the object.
3. The luggage appears stationary and unattended, not in the process of being carried or wheeled by someone just out of frame.

Do NOT confirm if:
- A person is visible anywhere near the luggage, even partially (arm, leg, shadow visible at the edge of frame).
- The object is ambiguous and could be furniture, a plant pot, or a decorative item.
- The luggage is clearly in motion or being handled.
- Only a small bag or purse is visible that a seated person could have placed beside them.

Answer in JSON: {"confirmed": true/false, "description": "describe the object type, its position, and whether any human figure is visible nearby", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "cabinet_item_taken_context": """Analyze these video frames from a hotel lounge bar area.
Determine whether a person is actively taking or handling items from inside the storage cabinet (bar cabinet or service locker visible in the background).
Confirm TRUE if ANY of the following are visible:
- A person standing with their back turned toward the cabinet, arms extended or reaching inside it
- A person's hands clearly inside the cabinet opening, touching or grabbing stored items
- A person turning away from the cabinet while visibly holding an object (bottle, box, bag, or any item) that was likely retrieved from inside
- The cabinet is open and a person is in close proximity with an item in hand that was not there before
Do NOT confirm if: the person is merely standing near the closed cabinet, the cabinet door is shut, the person's hands are at their sides with nothing in them, or the action is ambiguous.
Pay particular attention to body posture — a person seen mostly from behind with arms raised toward the cabinet interior is a strong positive indicator even if their face is not visible.
Answer in JSON: {"confirmed": true/false, "description": "brief description of posture, hand position, and any items visible", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "checkin_desk_context": """Analyze these video frames from a hotel entrance, recorded by an overhead fisheye camera.
Determine whether a hotel guest is performing a check-in interaction at the reception desk.

Confirm TRUE if ANY of the following are visible:
1. A person standing on the guest side of the reception counter, leaning forward with one or both arms resting on or extended toward the desk surface.
2. A person holding or placing a small flat object (document, passport, ID card, credit card, key card, printed voucher) on the desk or toward the counter.
3. A person in close proximity to the desk with their upper body inclined forward, in a posture consistent with showing, signing, or handling paperwork.

Context: the reception operator is NOT visible from this camera angle. Evaluate ONLY the guest side of the desk.

Do NOT confirm if:
- The person is standing upright at a distance from the desk without leaning toward it.
- The person is walking past the desk without stopping.
- No person is visible near the desk at all.
- The person appears to be cleaning or performing maintenance (mop, bucket, uniform with cleaning equipment).

Answer in JSON: {"confirmed": true/false, "description": "describe the person's position relative to the desk, body posture, and any visible object being presented", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "generic": """Analyze these video frames and describe what you see.
Focus on any unusual or notable activity.
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",
}


def get_prompt(key: str | None) -> str:
    return PROMPT_CATALOG.get(key or "generic", PROMPT_CATALOG["generic"])
