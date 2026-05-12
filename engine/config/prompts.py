"""Catalogo prompt per LLM Vision escalation, indicizzato per llm_prompt_key.

I prompt devono funzionare in due modalità:
  - Standard: frame della sola finestra di rilevazione
  - Temporale: frame etichettati in sezioni BEFORE / DETECTION WINDOW / AFTER
    (il preamble temporale è aggiunto automaticamente da LLMVisionClient)

Quando i frame sono organizzati in sezioni temporali, il prompt deve indicare
all'LLM di sfruttare i cambiamenti tra sezioni per distinguere stati transitori
(persona si china e si rialza) da stati sostenuti (persona rimane a terra).
"""
from __future__ import annotations

PROMPT_CATALOG: dict[str, str] = {

    # ------------------------------------------------------------------
    # person_on_ground — temporal_context_sec: 3
    # ------------------------------------------------------------------
    "person_down": """These frames are from an overhead fisheye security camera mounted on the ceiling, looking down at the hotel lobby floor.

Determine whether a person has FALLEN or COLLAPSED and is lying flat on the floor.

THE KEY VISUAL TEST — analyze the body silhouette from above:

LYING ON THE FLOOR (confirm TRUE):
- Full body length visible from head to feet in one elongated shape
- Legs STRAIGHT and fully extended, covering their entire floor length
- Body covers a LARGE floor area — roughly the person's full height
- Silhouette is linear, like a long flat shape or a T / cross

BENDING OR CROUCHING (confirm FALSE):
- Body COMPACT — folded into a small floor area
- Legs BENT — knees visible as raised points, feet tucked beside the torso
- Silhouette is round or oval — all parts clustered together
- Floor footprint is SMALL compared to the person's actual size

Confirm TRUE only if:
1. Silhouette is ELONGATED and LINEAR, covering a large floor area
2. Legs appear STRAIGHT and fully extended (not bent, not tucked under)
3. The full length from head to feet is visible

If BEFORE / AFTER sections are present, use them to assess dynamics:
- If the person was walking/standing in BEFORE and the posture in DETECTION is compact or transient → FALSE
- If the person remains flat and extended across multiple sections → TRUE (sustained fall)
- If the posture appears only briefly and the person is upright in AFTER → FALSE (transient bend)

Do NOT confirm if:
- Silhouette is compact and clustered (crouching, kneeling, squatting, bending)
- Legs are visibly bent at the knees
- The person is standing or walking
- The person is seated on furniture

Answer in JSON: {"confirmed": true/false, "description": "silhouette shape (elongated or compact), leg position (straight or bent), floor area covered, and — if temporal sections present — what changed between sections", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # smoking — temporal_context_sec: 2
    # ------------------------------------------------------------------
    "smoking_context": """These frames are from a hotel common area security camera.

Is there a person actively smoking — holding a lit cigarette, cigar, or pipe between their fingers or lips?

Look for:
- A thin cylindrical object (cigarette/cigar) held between fingers or at the lips
- Hand raised repeatedly near the face (gesture pattern)
- Thin smoke trail rising from the object or from the mouth/nose

If BEFORE / AFTER sections are present, confirm only if the smoking gesture is visible in multiple sections (sustained behavior), not just a fleeting hand movement in a single frame.

Answer in JSON: {"confirmed": true/false, "description": "describe the object held, hand position, and any smoke visible; if temporal sections present, note whether the gesture is sustained or transient", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # fire_smoke
    # ------------------------------------------------------------------
    "fire_smoke_context": """These frames are from a hotel security camera.

Is there visible fire, flames, or thick smoke present in the scene?

Confirm TRUE only for:
- Visible flames (orange/yellow/red flickering light)
- Thick dark or white smoke cloud rising or spreading in the room

Do NOT confirm for: steam, normal lighting effects, cooking vapors, reflections, or dust.

Answer in JSON: {"confirmed": true/false, "description": "describe what is visible — flame color, smoke density, location in frame", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # unattended_luggage — temporal_context_sec: 5
    # ------------------------------------------------------------------
    "unattended_bag": """These frames are from a hotel common area security camera.

Is there a bag, suitcase, or backpack left on the floor or a surface with no person tending to it?

Confirm TRUE only if ALL of the following:
1. A clearly identifiable piece of luggage is visible (suitcase, backpack, duffel — NOT a small purse or decorative item)
2. No person is standing, sitting, or crouching within ~1 metre of the object
3. The luggage appears stationary and unattended

If BEFORE / AFTER sections are present:
- Check BEFORE: did someone leave the bag and walk away? (stronger confirmation)
- Check AFTER: is the bag still there unattended? (confirms sustained state)
- If a person is visible near the bag in BEFORE or AFTER, lean toward FALSE

Answer in JSON: {"confirmed": true/false, "description": "describe the object type, position, and whether any person is visible nearby in any section", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    "unattended_bag_entrance": """These frames are from the hotel entrance area, recorded by an overhead fisheye camera.

Determine whether there is an unattended piece of luggage left alone with no person nearby.

Confirm TRUE only if ALL of the following conditions are met:
1. A clearly identifiable piece of luggage is visible (suitcase with wheels, trolley, backpack, travel bag — NOT a small purse, shopping bag, or decorative item).
2. No human figure is standing, sitting, or crouching within approximately one metre of the object.
3. The luggage appears stationary and unattended, not in the process of being carried or wheeled.

If BEFORE / AFTER sections are present:
- BEFORE: did a person leave the bag and walk away? (strong positive indicator)
- AFTER: is the bag still there with no owner? (confirms sustained state)
- If a person returns in AFTER, lean toward FALSE (owner came back)

Do NOT confirm if:
- A person is visible anywhere near the luggage, even partially (arm, leg, shadow at the edge of frame)
- The object is ambiguous and could be furniture, a plant pot, or a decorative item
- Only a small bag or purse is visible that a seated person could have placed beside them

Answer in JSON: {"confirmed": true/false, "description": "describe the object type, position, and whether any human figure is visible nearby across all sections", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # cabinet_interaction — used by cabinet_opened signal
    # ------------------------------------------------------------------
    "cabinet_interaction_context": """These frames are from a hotel lounge bar area security camera focused on a storage cabinet.

Determine whether a person is physically interacting with the storage cabinet — touching the door handle or panel, pulling or pushing the door, or standing in close proximity with their body oriented toward the cabinet and in the act of opening or attempting to open it.

Confirm TRUE if ANY of the following are visible:
- A person's hands on or gripping the cabinet door handle, latch, or panel
- The cabinet door in motion (opening or closing) with a person directly in front of it
- A person leaning forward toward the cabinet at arm's reach, body clearly oriented toward it
- The cabinet door partially or fully open with a person positioned at the opening

If BEFORE / AFTER sections are present, use them to assess intent:
- BEFORE: was the person approaching the cabinet purposefully?
- DETECTION: are they in contact with or opening the door?
- AFTER: did the person step away from the cabinet (door interaction complete)?

Do NOT confirm if:
- The person is walking past the cabinet without stopping or turning toward it
- The person is standing nearby but facing away from the cabinet
- No person is near the cabinet — even if the door is open

Answer in JSON: {"confirmed": true/false, "description": "describe the person's position relative to the cabinet, hand contact with the door, door state (open/closed/in motion), and — if temporal sections present — the approach and departure sequence", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # cabinet_context
    # ------------------------------------------------------------------
    "cabinet_context": """These frames are from a hotel lounge bar area security camera.

Determine whether the storage cabinet (bar cabinet or service locker visible in the background) is clearly and fully open, with its door(s) visibly swung open and interior shelves or contents exposed.

Confirm TRUE only if: the cabinet door is unmistakably open AND either a person is actively accessing it or it is left unattended while open.
Do NOT confirm if: the cabinet appears closed or only slightly ajar, the door state is unclear, or it is a different piece of furniture (fridge, display case, window).

Answer in JSON: {"confirmed": true/false, "description": "describe what is visible — door state, whether shelves are exposed, whether a person is present", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # cabinet_taken — temporal_context_sec: 4
    # ------------------------------------------------------------------
    "cabinet_item_taken_context": """These frames are from a hotel lounge bar area security camera.

Determine whether a person is taking or handling items from inside the storage cabinet.

Confirm TRUE if ANY of the following are visible:
- A person with arms extended or reaching inside the cabinet opening
- A person's hands clearly inside the cabinet, touching or grabbing stored items
- A person turning away from the cabinet while visibly holding an object (bottle, box, bag) that was not in their hands before
- The cabinet is open and a person is in close proximity with a new item in hand

If BEFORE / AFTER sections are present, use them to track the full interaction:
- BEFORE: was the person approaching the cabinet with empty hands?
- DETECTION: are they reaching inside or at the cabinet?
- AFTER: are they walking away holding something new?
A complete APPROACH → ACCESS → DEPART sequence is a strong positive indicator.

Do NOT confirm if: the person is merely standing near the closed cabinet, hands are at their sides with nothing in them, or the action is clearly ambiguous.

Answer in JSON: {"confirmed": true/false, "description": "describe body posture, hand position, any items visible, and — if temporal sections present — the sequence of actions observed", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # checkin_desk
    # ------------------------------------------------------------------
    "checkin_desk_context": """These frames are from a hotel entrance recorded by an overhead fisheye camera looking down at the reception desk.

Determine whether a hotel guest is performing a check-in interaction at the reception desk.

Confirm TRUE if ANY of the following are visible:
1. A person standing on the guest side of the counter, leaning forward with one or both arms resting on or extended toward the desk surface.
2. A person holding or placing a small flat object (document, passport, ID card, credit card, key card, printed voucher) on the desk or toward the counter.
3. A person in close proximity to the desk with their upper body inclined forward, in a posture consistent with showing, signing, or handling paperwork.

Context: the reception operator is NOT visible from this camera angle. Evaluate ONLY the guest side of the desk.

Do NOT confirm if:
- The person is standing upright at a distance from the desk without leaning toward it
- The person is walking past the desk without stopping
- No person is visible near the desk at all
- The person appears to be cleaning or performing maintenance

Answer in JSON: {"confirmed": true/false, "description": "describe the person's position relative to the desk, body posture, and any visible object being presented", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # tailgating — temporal_context_sec: 3
    # ------------------------------------------------------------------
    "tailgating_context": """These frames are from a hotel entrance security camera.

Determine whether two people are passing through a doorway in immediate close succession — one following directly behind the other without a gap (tailgating).

Confirm TRUE if:
- Two distinct people are visible passing through or immediately near the doorway
- The second person follows the first with no meaningful gap between them (less than one step apart)
- The sequence happens within the same short time window

If BEFORE / AFTER sections are present:
- BEFORE: was only one person approaching or entering?
- DETECTION: are two people simultaneously in or at the doorway?
- AFTER: did both people pass through?
A single person in BEFORE and two people in DETECTION is a strong positive indicator.

Do NOT confirm if:
- Only one person is passing through
- Two people enter with a normal gap (one has already cleared the door before the next arrives)
- The second person is waiting outside, not following immediately

Answer in JSON: {"confirmed": true/false, "description": "describe how many people are visible, their proximity, and — if temporal sections present — the sequence of entry", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # door_forced
    # ------------------------------------------------------------------
    "door_forced_context": """These frames are from a hotel entrance security camera.

Is a person attempting to force or push open a door that is not opening normally?

Confirm TRUE if:
- A person is pushing, pulling, or leaning hard against a door that does not open
- The person makes repeated attempts to force entry (body leaning against the door or door frame)
- The posture is consistent with forcing — strong forward lean, hands on door, body weight applied

Do NOT confirm if:
- The person is calmly opening or closing a door normally
- The person is simply standing near the door
- The door opens normally for the person

Answer in JSON: {"confirmed": true/false, "description": "describe the person's posture, hand/body contact with the door, and whether the door appears to open", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # dog_presence
    # ------------------------------------------------------------------
    "dog_presence": """These frames are from a hotel common area security camera.

Determine whether a dog or other domestic animal is present in the scene.

Confirm TRUE only if ALL of the following are visible:
1. An animal is clearly identifiable as a dog — four legs, fur, canine body shape (snout, ears, tail).
2. The dog is on the floor, being walked on a leash, seated, or carried/held by a person.
3. The animal is unmistakably a dog and not a toy, a bag, or another animal.

Do NOT confirm if:
- The scene shows only people with no animal visible
- The shape is ambiguous and could be a bag, clothing, or furniture
- Only a leash or collar is visible but no animal body is in frame

Answer in JSON: {"confirmed": true/false, "description": "describe the animal's position, size, and whether it is on a leash or held by someone", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # generic fallback
    # ------------------------------------------------------------------
    "generic": """Analyze these video frames and describe what you see.
Focus on any unusual or notable activity.
Answer in JSON: {"confirmed": true/false, "description": "brief description", "confidence": 0.0-1.0}
Only respond with valid JSON.""",
}


def get_prompt(key: str | None) -> str:
    return PROMPT_CATALOG.get(key or "generic", PROMPT_CATALOG["generic"])
