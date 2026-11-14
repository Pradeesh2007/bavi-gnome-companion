#!/usr/bin/env python3
"""
tools/analyze-foot-contact.py: measures where Bavi's planted foot touches the ground in every walking frame and how far
it moves between consecutive frames. READ ONLY: it never modifies a frame. Output is a JSON table (see --out) that
tools/build-walk-assets.py copies into the manifest, plus a readable report.

Method (source frames, 720x1280):
  * body mask = alpha >= 128; the zone below (lowest row - 140) holds the legs and shoes
  * each connected region of that zone is a foot; its ground contact = centroid of its lowest 7 rows
  * a foot is PLANTED when its lowest row is within 6 px of the lowest row of the whole figure
  * between frame i and i+1 the planted foot's contact moves by d (negative = backwards relative to the body). For a
    foot that stays put in the world, the figure must advance by -d. Where two planted feet both match, their values
    are averaged. `track[i]` = -d for the interval i -> i+1, in SOURCE pixels (the build tool converts to runtime px).
Needs: Python 3, Pillow, numpy, scipy.   Usage: python3 tools/analyze-foot-contact.py [--src art-source/walking] [--out walk-foot-contact.json]
"""
import argparse, json, os, re, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

PATTERN = re.compile(r'^(standingToWalking|walkingToStanding|walking)F(\d+)\.png$', re.I)
SEQ = {'standingtowalking': 'start', 'walking': 'loop', 'walkingtostanding': 'stop'}
ZONE, PLANT_TOL, MIN_AREA = 140, 6, 1200


def frames_of(src):
    found = {'start': {}, 'loop': {}, 'stop': {}}
    for n in os.listdir(src):
        m = PATTERN.match(n)
        if m:
            found[SEQ[m.group(1).lower()]][int(m.group(2))] = n
    return {s: [d[i] for i in sorted(d)] for s, d in found.items()}


def feet(path):
    a = np.array(Image.open(path).convert('RGBA'))
    solid = a[:, :, 3] >= 128
    rows = np.where(solid.any(axis=1))[0]
    low = int(rows.max())
    zone = solid[low - ZONE:low + 1]
    lab, k = ndi.label(zone, structure=np.ones((3, 3)))
    out = []
    for j in range(1, k + 1):
        comp = lab == j
        if comp.sum() < MIN_AREA:
            continue
        ys, xs = np.where(comp)
        bottom = int(ys.max())
        lowx = np.where(comp[max(0, bottom - 6):bottom + 1].any(axis=0))[0]
        out.append({'bottom': bottom + low - ZONE, 'cx': float(lowx.mean()), 'width': int(lowx.max() - lowx.min() + 1)})
    return low, out


def planted(fs):
    if not fs:
        return []
    lowest = max(f['bottom'] for f in fs)
    return [f for f in fs if f['bottom'] >= lowest - PLANT_TOL]


def interval(pa, pb):
    """Backward motion of the planted foot between two frames (source px, positive = foot moved backwards)."""
    cands = [a['cx'] - b['cx'] for a in pa for b in pb if -14 <= a['cx'] - b['cx'] <= 175]
    if not cands:
        return None
    # two planted feet that both match agree when truly planted: keep the matches that are close to the median
    med = float(np.median(cands))
    keep = [c for c in cands if abs(c - med) <= 40] or cands
    return float(np.mean(keep))


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', default=os.path.join(here, 'art-source', 'walking'))
    ap.add_argument('--out', default=os.path.join(here, 'art-source', 'walk-foot-contact.json'))
    args = ap.parse_args()
    files = frames_of(args.src)
    data = {}
    for seq in ('start', 'loop', 'stop'):
        fs = [feet(os.path.join(args.src, n)) for n in files[seq]]
        data[seq] = (fs, [planted(f[1]) for f in fs])
    result = {}
    for seq, nxt in (('start', 'loop'), ('loop', 'loop'), ('stop', None)):
        fs, pl = data[seq]
        track = [interval(pl[i], pl[i + 1]) for i in range(len(fs) - 1)]
        # entry i = backward foot motion while frame i is shown: the last frame leads into the next sequence
        if nxt is not None:
            track.append(interval(pl[-1], data[nxt][1][0]))   # start -> loop[0]; loop -> loop[0] (the loop closes)
        else:
            track.append(0.0)                                  # the last stop frame is the standing pose: no motion
        result[seq] = {'files': files[seq], 'track': track,
                       'planted': [[round(p['cx'], 1) for p in ps] for ps in pl],
                       'lowest_row': [f[0] for f in fs]}
    # the loop -> stop hand-off is reported for information only (the loop's own closing interval is used for motion)
    result['loop']['to_stop'] = interval(data['loop'][1][-1], data['stop'][1][0])
    with open(args.out, 'w') as fh:
        json.dump(result, fh, indent=1)
    for seq, r in result.items():
        print(f"{seq}: advance needed while each frame is shown (source px, -- = no planted pair): " + ' '.join('--' if t is None else f'{t:.0f}' for t in r['track']))
    print(f"loop last frame -> stop first frame (information): {result['loop']['to_stop']}")


if __name__ == '__main__':
    main()
