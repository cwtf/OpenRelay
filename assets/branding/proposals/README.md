# OpenRelay logo proposals

Open `index.html` to browse the concepts, or `comparison.png` for the complete board with actual-size and monochrome previews. These are original vector explorations. Rounded Tail, variant 06 in speech-r/round-bubble/outline-variants/, is the selected production icon; its canonical artwork and generator are documented in ../README.md.

| Direction | Idea | Strength | Tradeoff |
| --- | --- | --- | --- |
| 01 OR Ligature | An overlapping O and R with a shared stem | Direct connection to OpenRelay; recommended direction | The shared strokes merit optical refinement for the final 16 px icon |
| 02 Open Conversation | An open O, conversation tail, and detached dot | Friendly, simple silhouette | Can also read as a Q; less explicit connection to the name |
| 03 Relay Handoff | Two opposing rounded arrows | Expresses exchange and relay; warm palette | Familiar sync/repost symbolism makes it less distinctive |
| 04 Thread Pair | Two reply bubbles connected by a thread rail | Preserves continuity with the current Open Thread identity | More detail at small sizes; a modest evolution rather than a large departure |

Each numbered concept includes:

- `.svg`: rounded-square app icon, 512-unit viewBox.
- `-mark.svg`: transparent standalone mark using `currentColor` (with a default brand color).
- `.png`: transparent 512 px app icon preview.

The board uses Segoe UI for the sample wordmarks. The symbols use geometry only and have no font dependency. Palettes are exploratory and can be exchanged between concepts. The one-color previews show the same symbol geometry without relying on accent colors.

Reproduce all outputs with `python assets/branding/proposals/generate.py` from the repository root. Requires Pillow and the Windows Segoe UI fonts. No app build or asset generator is invoked.

Before adopting a direction, refine its small-size geometry and produce the platform-specific icon assets from the selected master. The concepts have not undergone a trademark clearance search.
