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
    # Camera: side/frontal view at medium height, person typically back to camera.
    # Cabinet: tall glass-panel honesty bar with dark metal frame and wooden shelves.
    # Scene note: large decorative glass globe pendant lamps hang in the foreground
    #             in front of the cabinet — these are room fixtures, NOT cabinet items.
    # ------------------------------------------------------------------
    "cabinet_interaction_context": """These frames are from a hotel lounge bar area security camera focused on a tall glass-panel display cabinet (honesty bar / minibar vitrine with dark metal frame and wooden interior shelves).

Determine whether a person is ACCESSING the cabinet — the glass door is open and the person is at the interior or reaching toward the shelves.

SCENE NOTE: Large round decorative glass globes or pendant lamps may appear in the foreground between the camera and the cabinet. These are fixed room decorations — ignore them when assessing whether items are being taken from the cabinet.

Confirm TRUE if ALL of the following:
1. The glass cabinet door is visibly open (door panel displaced or interior shelves clearly accessible and exposed).
2. The person is standing upright or leaning slightly forward in front of the open cabinet — NOT crouching at floor level.
3. The person's body is oriented toward the cabinet interior — they are close to it, with arms raised or extended toward the shelves, or their torso is partially inside.

Do NOT confirm if:
- The cabinet glass door remains closed in all frames.
- The person is crouching low at floor level (cleaning posture) with the door closed.
- The person appears to be wiping, polishing, or cleaning the glass exterior.
- The person is simply standing near the cabinet without engaging with its interior.

If BEFORE / AFTER frames are present:
- BEFORE: was the person approaching with empty hands (no cleaning cloth/mop)?
- DETECTION: is the door open and the person engaging with the interior or the door handle?
- AFTER: did the person step back with an item or close the door?

Answer in JSON: {"confirmed": true/false, "description": "state whether the glass door is open or closed, the person's posture, and what their hands/arms are doing relative to the cabinet interior", "confidence": 0.0-1.0}
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
    # cabinet_taken — temporal_context_sec: 6
    # Camera: side/frontal view at medium height, person back to camera.
    # Cabinet: tall glass-panel honesty bar, dark metal frame, wooden shelves
    #          stocked with snack boxes, bottles, drinks.
    # Scene note: large round decorative glass globe pendant lamps hang in the
    #             foreground — fixed room fixtures, NOT items from the cabinet.
    # ------------------------------------------------------------------
    "cabinet_item_taken_context": """These frames are from a hotel lounge bar area security camera focused on a tall glass-panel display cabinet (honesty bar / minibar vitrine with dark metal frame and wooden shelves stocked with food, drinks and snacks).

Determine whether a person is removing or retrieving an item from INSIDE the open cabinet.

SCENE NOTE: Large round decorative glass globes or pendant lamps may appear in the foreground between the camera and the cabinet. These are fixed room fixtures — do NOT interpret them as items being taken from the cabinet.

The person will typically be seen from behind (back to camera). This is normal — their arm reaching into the cabinet interior is still visible even from this angle.

Confirm TRUE if:
1. The glass cabinet door is visibly open (interior shelves accessible, door panel displaced or clearly swung aside).
2. The person's arm or hand is visibly extended toward or inside the cabinet opening — reaching toward the shelves, gripping a product, or withdrawing their arm with an item.
3. The person is standing upright or slightly bent at the waist (NOT crouching at floor level).

A confirmed "taken" event does NOT require the item to be clearly identified in hand after retrieval — it is sufficient that the arm entered the cabinet interior during the detection window.

Do NOT confirm if:
- The cabinet door is closed in all frames.
- The person is crouching low at floor level near the cabinet base (cleaning posture).
- The person is holding a cloth, sponge or mop (cleaning staff).
- The person is standing near the cabinet but their arm never enters or reaches toward the interior.
- The arm movement is toward the glass exterior surface only, not the interior.

If BEFORE / AFTER frames are present:
- BEFORE: person approaching with empty hands or pulling open the door.
- DETECTION: arm extended into or withdrawn from the cabinet interior.
- AFTER: person stepping back, possibly holding an item (bottle, box, snack) — or closing the door.

The target pattern is: APPROACH → DOOR OPEN → ARM INSIDE → DEPART. Partial sequences (e.g. door already open at detection) are still confirmable if the arm-inside condition is met.

Answer in JSON: {"confirmed": true/false, "description": "state whether the door is open, whether the person's arm entered the cabinet interior, the person's posture, and any item observed being held after the interaction", "confidence": 0.0-1.0}
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

Determine whether a live dog or other domestic animal is present in the scene.

Confirm TRUE only if ALL of the following are met:
1. The animal's HEAD is clearly visible — you can see a recognisable animal snout/muzzle, ears, and eyes. This is MANDATORY. A rounded or furry shape without a visible head is NOT sufficient.
2. The body is unmistakably that of a live animal (dog, cat, etc.) — NOT a toy, bag, cushion, or piece of furniture.
3. For MAXIMUM confidence also confirm: four paws are visible on the floor or being held, and a tail or leash is present.

CRITICAL — do NOT confirm if:
- You see only people, chairs, sofas, or furniture — even rounded, tufted, or velvety shapes are NOT animals
- Round-backed chairs, cushions, or ottomans can look like animal bodies from above — they are NOT animals
- A person is crouching, sitting low, or kneeling — that alone does NOT indicate an animal nearby
- The shape is ambiguous and no animal head (snout, muzzle) is clearly identifiable

Answer in JSON: {"confirmed": true/false, "description": "describe what you see — if an animal, describe its head, body, position and leash; if no animal, explain what the rounded or ambiguous shape actually is", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # locker_interaction — temporal_context_sec: 4
    # Camera: ceiling-mounted, top-down view of hotel hallway corridor.
    # Lockers: wooden hotel-style cabinet panels with electronic card readers.
    # Key insight: from this angle doors may NEVER appear visibly open.
    # ------------------------------------------------------------------
    "locker_interaction_context": """These frames are from a ceiling-mounted security camera looking DOWN into a hotel hallway. Wooden locker cabinets run along one wall.

IMPORTANT CAMERA CONTEXT:
- The viewpoint is overhead — people appear as heads and backs from above, not from the side.
- The lockers are wooden hotel-style cabinet panels with small electronic readers or keypads on their surface.
- Because of the top-down angle, locker doors may not appear visibly open even when being accessed — the panel gap is not visible from above.

Determine whether a person is ACCESSING the lockers: using a key fob, card or code at the reader, or depositing/retrieving items.

Confirm TRUE if ANY of the following sequences is visible:
1. A person stops directly beside the locker unit and reaches a hand toward the wooden panel — consistent with tapping a key fob, card or NFC token on the reader.
2. A person is crouching or bending at the locker, with their body oriented toward the cabinet surface, consistent with opening a lower compartment or retrieving an item.
3. A person holds a small object (card, fob, phone, token) and brings it close to the locker panel.

Do NOT confirm if:
- A person is merely walking past the lockers without pausing or turning toward them.
- People are standing in the hallway but clearly not oriented toward or engaged with the locker cabinet.
- The only presence near the locker is legs or feet briefly passing the edge of frame with no deliberate movement toward the unit.

Use the temporal sequence (BEFORE / DETECTION WINDOW / AFTER) to distinguish a deliberate locker access from a person who simply happens to be near the locker wall.

Answer in JSON: {"confirmed": true/false, "description": "describe the person's position relative to the locker cabinet, their body orientation, any object visible in their hand (fob/card/bag), and whether the sequence suggests deliberate locker access", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # vehicle_loading_unloading — temporal_context_sec: 4
    # ------------------------------------------------------------------
    "vehicle_loading_context": """These frames are from a security camera overlooking a hotel parking area or driveway.

Determine whether a person is actively LOADING or UNLOADING objects from a vehicle.

Confirm TRUE only if ALL of the following are visible:
1. A vehicle (car, van, taxi, etc.) is present with its boot/trunk, rear door, or side door visibly OPEN.
2. A person is actively transferring objects — carrying, lifting, dragging bags, boxes, suitcases or luggage — between the vehicle and the ground or vice versa.
3. The transfer is clearly in progress: items are mid-air, being placed in the boot, or being pulled out of it.

CRITICAL — do NOT confirm if:
- A person is simply standing near a vehicle without moving objects
- The vehicle boot/door is closed — even if luggage is visible on the ground nearby
- A person is merely walking past a parked car
- The vehicle is moving or driving through — loading/unloading only happens when stationary
- Only a driver is visible entering or exiting the vehicle with no additional cargo

If temporal frames are provided (BEFORE / DETECTION WINDOW / AFTER), use the sequence to verify that objects are being moved between the vehicle and the outside.

Answer in JSON: {"confirmed": true/false, "description": "describe what is being transferred, the vehicle type, door state and direction of transfer (loading/unloading)", "confidence": 0.0-1.0}
Only respond with valid JSON.""",

    # ------------------------------------------------------------------
    # garage_door_open — temporal_context_sec: 3
    # ------------------------------------------------------------------
    "garage_door_context": """These frames are from a security camera overlooking the entrance of a hotel bike storage area.

The door is a LARGE HINGED GATE made of frosted or translucent glass panels in a metal grid frame. It opens by SWINGING TO THE SIDE on hinges — it does NOT roll up or retract overhead.

Determine whether the gate/door is currently OPEN or is in the act of being opened.

Confirm TRUE if ANY of the following is visible:
1. A gap or open passageway is visible where the door panel meets the wall or frame — the door has clearly swung away from its closed position.
2. The door panel is visibly displaced to one side, angled away from the facade, revealing an opening.
3. The threshold or entrance is unobstructed and accessible — you can see through or past the open door panel to the area beyond.

CRITICAL — do NOT confirm if:
- All door panels are flush and aligned with the wall — door fully closed, no gap visible
- You cannot clearly see whether the door is open or closed due to the camera angle or image quality
- A person nearby is the only evidence — the door panel itself must be visibly open or displaced

The camera views the door from an elevated angle. A closed door shows all glass panels aligned in a flat continuous wall. An OPEN door shows at least one panel swung out, creating a visible gap or opening.

If temporal frames are provided (BEFORE / DETECTION WINDOW / AFTER), compare the door position across frames — a panel that shifted position indicates opening.

Answer in JSON: {"confirmed": true/false, "description": "describe the door panel position — flush/closed, swung open with gap visible, or partially open — and cite the specific visual evidence", "confidence": 0.0-1.0}
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
