"""Compose 6s of bottle sorting + 6s of recycling plant footage into a 12s kiosk video.
Usage: .tools/vision/bin/python scripts/app-profile-media/prepare-video.py INTRO_VIDEO PLANT_VIDEO
"""
import sys
from pathlib import Path
import cv2

cv2.setNumThreads(2)
output = Path(__file__).resolve().parents[2] / 'assets/media/recycling-12s.webm'
output.parent.mkdir(parents=True, exist_ok=True)
staged = output.with_name('recycling-12s-staged.webm')
writer = cv2.VideoWriter(str(staged), cv2.VideoWriter_fourcc(*'VP80'), 25, (1280, 720))
assert writer.isOpened(), 'VP8 encoder unavailable'
for filename, start in [(sys.argv[1], 0), (sys.argv[2], 2)]:
    source = cv2.VideoCapture(filename)
    assert source.isOpened(), filename
    fps = source.get(cv2.CAP_PROP_FPS)
    assert fps > 0
    source.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    decoded = -1
    frame = None
    for index in range(150):
        target = int(index * fps / 25)
        while decoded < target:
            ok, frame = source.read()
            assert ok, f'Source ended: {filename}'
            decoded += 1
        writer.write(cv2.resize(frame, (1280, 720), interpolation=cv2.INTER_AREA))
    source.release()
writer.release()
check = cv2.VideoCapture(str(staged))
duration = check.get(cv2.CAP_PROP_FRAME_COUNT) / check.get(cv2.CAP_PROP_FPS)
assert abs(duration - 12) < 0.01, duration
check.release()
staged.replace(output)
print(f'{output}: {duration:.2f}s, 1280x720, VP8, no audio')
