# Crabgic brand assets

Everything here is derived from the owner's mascot artwork — the orange crab in a purple
wizard hat — kept in `source/crabgic-mascot-1024.png`. Nothing was redrawn; the artwork is
matted, split, and resampled.

The artwork was authored on a dark ground with a glow around it. That matters for how the
files are organised: **the dark-ground variants are the artwork as designed**, and the
transparent variants are a cutout of it.

## Files

| File | Use |
| --- | --- |
| `crabgic-logo.png`, `crabgic-logo-512.png` | Full lockup, crab plus wordmark, on brand ink. README hero, docs header, social card. |
| `crabgic-icon-{512,256,180,128,64,48,32,16}.png` | Square icon, crab only, on brand ink. npm art, GitHub avatar, marketplace tile, favicons. |
| `transparent/…` | The same set matted to transparency, for placing on a background of your own. |
| `vector/crabgic-icon.svg`, `vector/crabgic-icon-small.svg` | Vector fallback for small sizes — see the caveat below. |
| `source/crabgic-mascot-1024.png` | The original artwork, background intact. The master; everything else is generated from it. |
| `source/mascot.py`, `source/png.py` | The generator. Run `python3 source/mascot.py` to rebuild every file from the master. No dependencies. |

## Which variant

- **On ink (default, top level).** The glow renders as it was drawn. Use for anything that
  gets its own tile or avatar — npm, GitHub, the plugin marketplace, favicons.
- **Transparent.** Use when the icon sits on a surface you control. The cutout is clean on
  the crab itself, but a soft halo survives around the sparkles: it is part of the source
  artwork, not a matting error, and removing it entirely would mean repainting. On a light
  page it reads as a faint smudge. The transparent *lockup* is the weakest of the set —
  the wordmark is dark indigo drawn for a dark ground, so it has little contrast on white.

## Size caveat

The mascot carries a lot of detail: spectacles, a laptop, a crescent moon, sparkles. It
holds up to about 48px. At 32px it softens, and at 16px it is a coloured blob rather than a
readable crab.

`vector/` holds a simplified redraw of the same character that stays legible down to 16px.
It is kept only as a favicon fallback — if you would rather have the real artwork at every
size and accept the blur, the vector files can be deleted.

## Palette

Sampled from the artwork.

| Token | Hex | Where |
| --- | --- | --- |
| Shell | `#F97036` | Crab body and pincers |
| Belly | `#FBB07A` | Underside |
| Hat | `#6B3FC9` | Wizard hat |
| Hat light | `#8257E0` | Brim highlight |
| Hat dark | `#4A2794` | Hat band |
| Gold | `#FBBF24` | Star, moon, sparkles |
| Ink | `#1B1B45` | Outlines, and the dark ground the icons sit on |

## Rebuilding

`python3 source/mascot.py` regenerates every PNG from the master. The script mattes the
grey studio background out, finds the row of least ink between the crab and the wordmark to
split them, trims to the artwork, and box-filters each size with premultiplied alpha. The
thresholds it uses are documented as constants at the top of the file.
