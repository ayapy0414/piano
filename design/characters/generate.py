"""Gemini でキャラクター画像を生成する。使い方: python3 generate.py [キャラ名 ...] [--n 枚数]"""
import base64, json, os, sys, urllib.request, pathlib
MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
here = pathlib.Path(__file__).parent
cfg = json.loads((here / "prompts.json").read_text())
args = sys.argv[1:]; n = 1
if "--n" in args: i = args.index("--n"); n = int(args[i+1]); del args[i:i+2]
names = args or list(cfg["characters"])
out = here / "images"; out.mkdir(exist_ok=True)
for name in names:
    prompt = cfg["style"] + "\n\nCharacter: " + cfg["characters"][name]
    for j in range(n):
        body = {"contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseModalities": ["IMAGE"]}}
        req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
              headers={"Content-Type": "application/json",
                       "x-goog-api-key": os.environ.get("GEMINI_API_KEY", "placeholder")})
        try:
            res = json.load(urllib.request.urlopen(req, timeout=180))
        except urllib.error.HTTPError as e:
            print(name, j, "HTTP", e.code, e.read().decode()[:400]); continue
        parts = res.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        imgs = [p["inlineData"] for p in parts if "inlineData" in p]
        if not imgs: print(name, j, "no image:", json.dumps(res)[:400]); continue
        ext = ".png" if "png" in imgs[0]["mimeType"] else ".jpg"
        f = out / f"{name}_{j+1}{ext}"; f.write_bytes(base64.b64decode(imgs[0]["data"])); print("saved", f)
