#!/usr/bin/env python3
"""
tools/build-walk-assets.py: builds the runtime walking assets from the approved source frames.

  art-source/walking/*.png            INPUT (read only, never modified): 42 frames, 720x1280 RGBA
  art-source/walking_270x480/*.png    OUTPUT: runtime copies, one file per frame (not shipped in the extension)
  assets/walk/walk.png                OUTPUT: one atlas holding all runtime frames (shipped)
  assets/walk/walk.json               OUTPUT: manifest: sequences, frame positions, baseline offsets, timing

Sequences are found from the file names (case-insensitive):
    standingToWalkingF<n>.png  -> start   (7 frames in the current art)
    walkingF<n>.png            -> loop    (10 frames)
    walkingToStandingF<n>.png  -> stop    (25 frames)
The frame counts are NOT fixed here; any contiguous 1..n numbering works.

Per-frame baseline: the lowest solid pixel (alpha >= 128) of every frame is measured at source resolution.
Every frame gets a vertical offset `dy` (runtime pixels, >= 0) that places its lowest point on the common baseline
(the lowest point over all frames, which the standing frames already reach, so they get dy = 0). The pixels of the
frames are NOT shifted: the offset is applied when drawing (lib/character/actor.js).

Needs Python 3, Pillow and numpy.  Usage (from the project directory):
    python3 tools/build-walk-assets.py [--timing-ms 93]
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image

SRC_W, SRC_H = 720, 1280
RUN_W, RUN_H = 270, 480           # runtime frame size (0.375 of the source on both axes)
COLS = 7                          # atlas columns
GUTTER_X = 2                      # transparent columns on each side of a frame
PAD_BOTTOM = 2
STRIDE_HEIGHTS = 0.56             # estimated stride (one full loop cycle) in character heights; tune in testing
MIN_SCALE, MAX_SCALE = 0.55, 1.45
TRAVEL_FRAMES = {'start': None, 'stop': 12}   # None = all frames of the sequence; stop value is an initial estimate

PATTERN = re.compile(r'^(standingToWalking|walkingToStanding|walking)F(\d+)\.png$', re.IGNORECASE)
SEQ_OF = {'standingtowalking': 'start', 'walking': 'loop', 'walkingtostanding': 'stop'}


def find_frames(src):
    found = {'start': {}, 'loop': {}, 'stop': {}}
    for name in sorted(os.listdir(src)):
        m = PATTERN.match(name)
        if not m:
            continue
        seq = SEQ_OF[m.group(1).lower()]
        index = int(m.group(2))
        if index in found[seq]:
            sys.exit(f'duplicate frame {seq} {index}: {name}')
        found[seq][index] = name
    out = {}
    for seq, items in found.items():
        if not items:
            sys.exit(f'no frames found for sequence "{seq}" in {src}')
        indices = sorted(items)
        if indices != list(range(1, len(indices) + 1)):
            sys.exit(f'sequence "{seq}" is not numbered 1..n without gaps: {indices}')
        out[seq] = [items[i] for i in indices]
    return out


def measure(rgba):
    """Lowest solid row and solid column range of a source frame (alpha >= 128)."""
    solid = rgba[:, :, 3] >= 128
    rows = np.where(solid.any(axis=1))[0]
    cols = np.where(solid.any(axis=0))[0]
    return int(rows.max()), int(cols.min()), int(cols.max()) + 1


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default=os.path.join(here, 'art-source', 'walking'))
    ap.add_argument('--runtime-frames', default=os.path.join(here, 'art-source', 'walking_270x480'))
    ap.add_argument('--out', default=os.path.join(here, 'assets', 'walk'))
    ap.add_argument('--timing-ms', type=float, default=93.0, help='initial frame time of every sequence')
    args = ap.parse_args()

    src = os.path.realpath(args.src)
    for target in (args.runtime_frames, args.out):
        t = os.path.realpath(target)
        if t == src or t.startswith(src + os.sep):
            sys.exit('refusing to run: an output folder is the source folder or inside it')

    frames = find_frames(src)
    os.makedirs(args.runtime_frames, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)

    # 1. measure and resize every frame
    entries = []   # (seq, index, name, lowest_row_src, runtime Image)
    figure = None
    for seq in ('start', 'loop', 'stop'):
        for i, name in enumerate(frames[seq], start=1):
            im = Image.open(os.path.join(src, name))
            if im.size != (SRC_W, SRC_H) or im.mode != 'RGBA':
                sys.exit(f'{name}: expected {SRC_W}x{SRC_H} RGBA, got {im.size} {im.mode}')
            rgba = np.array(im)
            lowest, left, right = measure(rgba)
            if seq == 'start' and i == 1:
                figure = (left, right)    # the standing figure (matches the idle pose) defines the alignment box
            small = im.resize((RUN_W, RUN_H), Image.LANCZOS)   # Pillow resamples RGBA with premultiplied alpha
            small.save(os.path.join(args.runtime_frames, f'{seq}_{i:02d}.png'), optimize=True)
            entries.append((seq, i, name, lowest, small))

    ratio = RUN_H / SRC_H
    baseline = max(e[3] for e in entries)
    dys = {(e[0], e[1]): round((baseline - e[3]) * ratio, 2) for e in entries}
    pad_top = math.ceil(max(dys.values())) + 2

    # 2. atlas
    cell_w = RUN_W + 2 * GUTTER_X
    cell_h = pad_top + RUN_H + PAD_BOTTOM
    rows = math.ceil(len(entries) / COLS)
    atlas = Image.new('RGBA', (COLS * cell_w, rows * cell_h), (0, 0, 0, 0))
    positions = {}
    for n, (seq, i, name, lowest, small) in enumerate(entries):
        cx, cy = (n % COLS) * cell_w, (n // COLS) * cell_h
        atlas.paste(small, (cx + GUTTER_X, cy + pad_top))
        positions[(seq, i)] = (cx + GUTTER_X, cy + pad_top)
    atlas.save(os.path.join(args.out, 'walk.png'), optimize=True)

    # 3. manifest
    sequences = {}
    for seq in ('start', 'loop', 'stop'):
        count = len(frames[seq])
        s = {
            'frameMs': args.timing_ms,
            'frames': [{'x': positions[(seq, i)][0], 'y': positions[(seq, i)][1], 'dy': dys[(seq, i)],
                        'source': frames[seq][i - 1]} for i in range(1, count + 1)],
        }
        if seq != 'loop':
            travel = TRAVEL_FRAMES[seq]
            s['travelFrames'] = count if travel is None else min(travel, count)
        sequences[seq] = s
    manifest = {
        'version': 1,
        'comment': 'Generated by tools/build-walk-assets.py. frameMs, travelFrames and motion.* are tunable by hand.',
        'frame': {'width': RUN_W, 'height': RUN_H},
        'atlas': {'image': 'walk.png', 'width': atlas.width, 'height': atlas.height},
        'figure': {'left': round(figure[0] * ratio, 2), 'right': round(figure[1] * ratio, 2)},
        'baselineRowSource': baseline,
        'motion': {'strideHeights': STRIDE_HEIGHTS, 'minScale': MIN_SCALE, 'maxScale': MAX_SCALE},
        'sequences': sequences,
    }
    with open(os.path.join(args.out, 'walk.json'), 'w') as fh:
        json.dump(manifest, fh, indent=1)
        fh.write('\n')

    size = os.path.getsize(os.path.join(args.out, 'walk.png'))
    print(f"frames: start {len(frames['start'])}, loop {len(frames['loop'])}, stop {len(frames['stop'])}")
    print(f'atlas {atlas.width}x{atlas.height} ({size / 1e6:.2f} MB PNG, {atlas.width * atlas.height * 4 / 1e6:.1f} MB decoded)')
    print(f"baseline row (source) {baseline}; offsets dy 0..{max(dys.values())} px; pad top {pad_top}")
    print(f"figure box {manifest['figure']}")


if __name__ == '__main__':
    main()
