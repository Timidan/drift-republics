"""Render 'Lanterns on the Tide', an original 48-second looping harbor motif.

Python stdlib only. Run with an output WAV path, then encode to Ogg with FFmpeg.
"""
import array
import math
import sys
import wave

RATE = 24000
DURATION = 48
track = [array.array('f', [0]) * (RATE * DURATION) for _ in range(2)]


def note(midi, start, length, level, pan, pluck=True):
    frequency = 440 * 2 ** ((midi - 69) / 12)
    for i in range(int(length * RATE)):
        t = i / RATE
        envelope = min(1, t / .025) * (math.exp(-t * 2.4) if pluck else math.sin(math.pi * t / length) ** 2)
        phase = 2 * math.pi * frequency * t
        value = level * envelope * (math.sin(phase) + .22 * math.sin(2 * phase) + .09 * math.sin(3.003 * phase))
        at = (round(start * RATE) + i) % len(track[0])
        track[0][at] += value * (1 - pan)
        track[1][at] += value * pan


# Four slow phrases in D Dorian, answering on the second half of the tide.
melody = [74, 77, 81, 79, 77, 74, 72, 76, 79, 81, 84, 81, 79, 76, 74, 69,
          74, 77, 81, 86, 84, 81, 79, 77, 76, 72, 69, 72, 76, 74, 69, 74]
for i, pitch in enumerate(melody):
    note(pitch, i * 1.5, 3, .19, .35 if i % 2 else .65)
for bar, chord in enumerate([(50, 57, 65), (48, 55, 64), (43, 57, 62), (50, 57, 64)] * 2):
    for pitch in chord:
        note(pitch, bar * 6, 6.5, .075, .5, False)
    note(chord[0] - 12, bar * 6, 5.5, .09, .5, False)
# Cross-channel reflections, wrapping the tail to make a continuous loop.
dry = [array.array('f', channel) for channel in track]
for delay, level in [(.31, .14), (.67, .08), (1.09, .045)]:
    offset = round(delay * RATE)
    for channel in range(2):
        for i, sample in enumerate(dry[1 - channel]):
            track[channel][(i + offset) % len(track[channel])] += sample * level
peak = max(abs(v) for channel in track for v in channel)
assert 0 < peak < 1, 'music must have signal and headroom'
pcm = array.array('h', (round(track[c][i] * 25000) for i in range(len(track[0])) for c in range(2)))
if sys.byteorder != 'little':
    pcm.byteswap()
with wave.open(sys.argv[1], 'wb') as output:
    output.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
    output.writeframes(pcm.tobytes())
print(f'Lanterns on the Tide: {DURATION}s stereo, peak {peak:.3f}')
