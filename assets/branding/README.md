# Rounded Tail

OpenRelay's icon uses a white round speech-bubble outline with a softened tail and a bold R inside, on blue (`#315bdd`). This is the selected Rounded Tail proposal (variant 06 in `proposals/speech-r/round-bubble/outline-variants/`).

- `rounded-tail.svg`: full rounded-square app icon.
- `rounded-tail-mark.svg`: white mark on a transparent background.
- `../../tools/build-icons.py`: shared geometry and asset generator (Python + Pillow).

Run `python tools/build-icons.py` from the repository root to regenerate the SVGs, desktop ICO/ICNS/PNG, browser extension PNGs and Android launcher resources. Generated assets are checked in so normal builds require no additional tools. Android uses separate background and foreground layers, with the mark inset for launcher masks, plus a monochrome layer for themed icons.
