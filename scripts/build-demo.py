#!/usr/bin/env python3
"""Assemble the final demo: narration track + captions + video mux.

Reads artifacts/demo-audio/{timings,scene-log}.json (written by
scripts/demo-tts.py and scripts/record-demo.mjs), builds a narration WAV with
each scene delayed to its recorded start, writes artifacts/demo-narration.srt,
and muxes everything into artifacts/aftermath-final-demo.mp4.
"""
import json, re, subprocess, sys, glob, os

AUDIO = "artifacts/demo-audio"
DELAY = 0.45

def probe(path, entries):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", entries,
                          "-of", "default=noprint_wrappers=1:nokey=1", path],
                         capture_output=True, text=True).stdout.strip().splitlines()
    return out

def fmt(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

def main():
    timings = json.load(open(f"{AUDIO}/timings.json"))
    log = {s["id"]: s for s in json.load(open(f"{AUDIO}/scene-log.json")) if "start" in s}
    webm = sorted(glob.glob("/tmp/demorec/video/*.webm"))[-1]
    vdur = float(probe(webm, "format=duration")[0])
    print(f"video {webm} {vdur:.2f}s")

    inputs, parts = [], []
    for i, sc in enumerate(timings):
        inputs += ["-i", f"{AUDIO}/{sc['id']}.wav"]
        ms = int((log[sc["id"]]["start"] + DELAY) * 1000)
        parts.append(f"[{i}]adelay={ms}:all=1[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(timings)))
    fc = ";".join(parts) + f";{mix}amix=inputs={len(timings)}:normalize=0,apad=whole_dur={vdur}[out]"
    subprocess.run(["ffmpeg", "-y", *inputs, "-filter_complex", fc, "-map", "[out]",
                    "-ar", "44100", "-ac", "2", "/tmp/demorec/narration.wav"],
                   check=True, capture_output=True)

    cues = []
    for sc in timings:
        start = log[sc["id"]]["start"] + DELAY
        sents = re.split(r"(?<=[.!?])\s+", sc["narration"].strip())
        total = sum(len(x) for x in sents)
        t = start
        for sent in sents:
            d = sc["seconds"] * len(sent) / total
            cues.append((t, t + d, sent)); t += d
    with open("artifacts/demo-narration.srt", "w") as f:
        for i, (a, b, txt) in enumerate(cues, 1):
            f.write(f"{i}\n{fmt(a)} --> {fmt(b)}\n{txt}\n\n")

    style = ("FontName=DejaVu Sans,FontSize=15,PrimaryColour=&H00F5F2EA,"
             "OutlineColour=&H00000000,BorderStyle=3,Outline=1,Shadow=0,"
             "MarginV=28,Alignment=2")
    subprocess.run(["ffmpeg", "-y", "-i", webm, "-i", "/tmp/demorec/narration.wav",
                    "-filter_complex",
                    f"[0:v]scale=1280:800,setsar=1,fps=25,subtitles=artifacts/demo-narration.srt:force_style='{style}'[v]",
                    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "medium",
                    "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
                    "-movflags", "+faststart", "-shortest", "artifacts/aftermath-final-demo.mp4"],
                   check=True, capture_output=True)
    print("wrote artifacts/aftermath-final-demo.mp4")
    print("duration", probe("artifacts/aftermath-final-demo.mp4", "format=duration")[0])

if __name__ == "__main__":
    main()
