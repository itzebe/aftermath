#!/usr/bin/env python3
"""Synthesize the demo narration with the local Piper neural voice.

Reads scripts/demo-scenes.json, writes one WAV per scene to
artifacts/demo-audio/<id>.wav, and prints the measured duration of each scene
so the recorder can pace the UI to the narration.

  python3 scripts/demo-tts.py --voice /tmp/piper/en_US-lessac-medium.onnx
"""
import argparse, json, os, wave
from piper import PiperVoice

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True, help="path to the .onnx voice model")
    ap.add_argument("--scenes", default="scripts/demo-scenes.json")
    ap.add_argument("--out", default="artifacts/demo-audio")
    args = ap.parse_args()

    scenes = json.load(open(args.scenes))
    os.makedirs(args.out, exist_ok=True)
    voice = PiperVoice.load(args.voice)
    timings = []
    for s in scenes:
        path = os.path.join(args.out, s["id"] + ".wav")
        with wave.open(path, "wb") as w:
            voice.synthesize_wav(s["narration"], w)
        with wave.open(path, "rb") as w:
            dur = w.getnframes() / float(w.getframerate())
        timings.append({"id": s["id"], "title": s["title"], "seconds": round(dur, 3),
                        "narration": s["narration"]})
        print(f"{s['id']:12s} {dur:6.2f}s")
    json.dump(timings, open(os.path.join(args.out, "timings.json"), "w"), indent=1)
    total = sum(t["seconds"] for t in timings)
    print(f"{'TOTAL':12s} {total:6.2f}s")

if __name__ == "__main__":
    main()
