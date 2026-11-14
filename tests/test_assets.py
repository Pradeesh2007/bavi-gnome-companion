#!/usr/bin/env python3
"""
REAL tests of the shipped walking assets (no mocks). Run from the project directory:  python3 tests/test_assets.py
Needs Python 3, Pillow and numpy. Checks that assets/walk/walk.png + walk.json are exactly what
tools/build-walk-assets.py makes from the approved source frames, and that nothing in the source was touched.
"""
import hashlib, json, os, re, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, 'art-source', 'walking')
RUNTIME = os.path.join(HERE, 'art-source', 'walking_270x480')
OUT = os.path.join(HERE, 'assets', 'walk')
passed = failed = 0

def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1; print(f'ok   {name}')
    else:
        failed += 1; print(f'FAIL {name} {detail}')

m = json.load(open(os.path.join(OUT, 'walk.json')))
atlas = Image.open(os.path.join(OUT, 'walk.png')); atlas.load()
A = np.array(atlas.convert('RGBA'))
fw, fh = m['frame']['width'], m['frame']['height']

srcs = sorted(n for n in os.listdir(SRC) if n.lower().endswith('.png'))
check('42 approved source frames present', len(srcs) == 42, len(srcs))
check('all source frames are 720x1280 RGBA and decode', all(Image.open(os.path.join(SRC, n)).size == (720, 1280) and Image.open(os.path.join(SRC, n)).mode == 'RGBA' for n in srcs))
check('atlas matches manifest size and is RGBA', atlas.size == (m['atlas']['width'], m['atlas']['height']) and atlas.mode == 'RGBA', atlas.size)
check('atlas texture is below 4096 px on both axes (safe GPU limit)', max(atlas.size) <= 4096, atlas.size)
counts = {k: len(v['frames']) for k, v in m['sequences'].items()}
check('sequences hold 7/10/25 frames', counts == {'start': 7, 'loop': 10, 'stop': 25}, counts)

# every manifest frame points at the right source file, and its atlas pixels equal a fresh 270x480 resize of that file
exact = True; worst = 0
for seq, s in m['sequences'].items():
    for i, f in enumerate(s['frames']):
        want = np.array(Image.open(os.path.join(SRC, f['source'])).convert('RGBA').resize((fw, fh), Image.LANCZOS))
        got = A[f['y']:f['y'] + fh, f['x']:f['x'] + fw]
        d = int(np.abs(want.astype(int) - got.astype(int)).max()); worst = max(worst, d)
        if d != 0: exact = False
check('every atlas frame equals a fresh resize of its source frame (pixel exact)', exact, f'max diff {worst}')

pat = re.compile(r'^(standingToWalking|walkingToStanding|walking)F(\d+)\.png$', re.I)
order_ok = True
want_seq = {'standingtowalking': 'start', 'walking': 'loop', 'walkingtostanding': 'stop'}
for seq, s in m['sequences'].items():
    nums = []
    for f in s['frames']:
        mm = pat.match(f['source']); order_ok &= bool(mm) and want_seq[mm.group(1).lower()] == seq; nums.append(int(mm.group(2)))
    order_ok &= nums == list(range(1, len(nums) + 1))
check('frames are mapped to the right sequence in numeric order (F1..Fn)', order_ok)

# runtime copies (one file per frame) equal the atlas content
rt_ok = True
for seq, s in m['sequences'].items():
    for i, f in enumerate(s['frames'], 1):
        r = np.array(Image.open(os.path.join(RUNTIME, f'{seq}_{i:02d}.png')).convert('RGBA'))
        rt_ok &= r.shape == (fh, fw, 4) and np.array_equal(r, A[f['y']:f['y'] + fh, f['x']:f['x'] + fw])
check('42 separate 270x480 runtime copies exist and equal the atlas frames', rt_ok and len(os.listdir(RUNTIME)) == 42)

# baseline offsets: lowest solid pixel of the DRAWN frame (after dy) is the same row for all frames; offsets never push content out
lows = []; dys = []; clipped = False
for seq, s in m['sequences'].items():
    for f in s['frames']:
        fr = A[f['y']:f['y'] + fh, f['x']:f['x'] + fw]
        rows = np.where((fr[:, :, 3] >= 128).any(axis=1))[0]
        lows.append(rows.max() + f['dy']); dys.append(f['dy'])
        clipped |= (rows.max() + f['dy']) > fh   # drawn content must stay inside the frame window
check('every frame has dy >= 0 and the largest is below the atlas padding', min(dys) >= 0 and max(dys) <= 12, (min(dys), max(dys)))
# The offsets are computed at source resolution (1 source row = 0.375 runtime px) while this check measures whole rows
# of the resized frames, so up to ~1.5 runtime px of quantisation is expected; without offsets the spread is 9 px.
spread_after = max(lows) - min(lows)
spread_before = max(l - d for l, d in zip(lows, dys)) - min(l - d for l, d in zip(lows, dys))
check(f'offsets bring the baseline spread from {spread_before:.1f} px to {spread_after:.2f} px (<= 1.5 px, >= 5x smaller)', spread_after <= 1.5 and spread_before >= 5 * spread_after, (spread_before, spread_after))
check('no frame is pushed out of its window by its offset', not clipped)
check('standing frames (start 1, stop 25) have dy = 0 so they overlay the idle sprite', m['sequences']['start']['frames'][0]['dy'] == 0 and m['sequences']['stop']['frames'][-1]['dy'] == 0)

# padding: the rows above each window (up to dy) and the gutter columns are transparent, so neighbours never show
pad_ok = True
for s in m['sequences'].values():
    for f in s['frames']:
        top = A[int(f['y'] - np.ceil(f['dy'])):f['y'], f['x']:f['x'] + fw]
        pad_ok &= int(top[:, :, 3].max(initial=0)) == 0 and int(A[f['y']:f['y'] + fh, f['x'] - 2:f['x'], 3].max()) == 0 and int(A[f['y']:f['y'] + fh, f['x'] + fw:f['x'] + fw + 2, 3].max()) == 0
check('the rows shifted into view by an offset, and the gutters, are fully transparent', pad_ok)

# nothing green left in the shipped atlas
r, g, b, a = [A[:, :, k].astype(int) for k in range(4)]
green = int(((a >= 48) & (g > r + 25) & (g > b + 10)).sum()); check('shipped atlas has (almost) no green-dominant pixels', green < 400, green)

# foot-contact data: one non-negative footTravel per frame, derived from the analysis file, footLock in range
an = json.load(open(os.path.join(HERE, 'art-source', 'walk-foot-contact.json')))
ft_ok = all(len(v['footTravel']) == len(v['frames']) and min(v['footTravel']) >= 0 for v in m['sequences'].values())
check('every frame has a non-negative footTravel value', ft_ok)
check('the analysis file matches the frames of every sequence (rerun tools/analyze-foot-contact.py if not)', all(an[k]['files'] == [f['source'] for f in m['sequences'][k]['frames']] for k in ('start', 'loop', 'stop')))
check('footLock values are within 0..1 and there is no stale strideHeights/travelFrames', all(0 <= v <= 1 for v in m['motion']['footLock'].values()) and 'strideHeights' not in m['motion'] and all('travelFrames' not in s for s in m['sequences'].values()))
loop_stride = sum(m['sequences']['loop']['footTravel']) / m['frame']['height']
check(f'measured loop stride is about 0.43 x character height (got {loop_stride:.3f})', 0.40 < loop_stride < 0.46)

# source frames unchanged against the recorded hashes
hf = os.path.join(SRC, 'SHA256SUMS')
if os.path.exists(hf):
    bad = [n for line in open(hf) for h, n in [line.split()] if hashlib.sha256(open(os.path.join(SRC, n), 'rb').read()).hexdigest() != h]
    check('source frames match their recorded SHA-256 (not modified since delivery)', not bad, bad[:3])
else:
    check('SHA256SUMS present for the source frames', False)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
