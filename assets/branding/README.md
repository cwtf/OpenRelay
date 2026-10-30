# Open Thread

OpenRelay's icon uses two white comment blocks joined by a thread rail on blue (`#1d63c4`).

- `open-thread.svg`: full rounded-square app icon.
- `open-thread-mark.svg`: white mark on a transparent background.
- `../../tools/build-icons.py`: shared geometry and asset generator (Python + Pillow).

Run `python tools/build-icons.py` from the repository root to regenerate the SVGs, desktop ICO/ICNS/PNG, browser extension PNGs and Android launcher resources. Generated assets are checked in so normal builds require no additional tools. Android uses separate background and foreground layers, with the mark inset for launcher masks, plus a monochrome layer for themed icons.
