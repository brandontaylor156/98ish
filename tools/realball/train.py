"""Real Ball candidate scorer: a tiny CNN that looks at a 3-frame RGB patch (24x24) around a
detector candidate and says ball / not ball. Trained on procedurally generated fence-cam
patches plus patches from the engine-rendered Pickleball 98 rally (first half), tested on the
held-out second half. Exports ONNX and a JSON of weights for the in-browser forward pass.

usage: python train.py  (expects realball/e2e/native.raw, pts.txt and engine_patches.npz)
"""
import json, math, os, sys, time
import numpy as np
import torch, torch.nn as nn

HERE = os.path.dirname(os.path.abspath(__file__))
P = 24  # patch size
rng = np.random.default_rng(1)
torch.manual_seed(1)

# ---------- procedural patches ----------
def court_bg():
    base = rng.choice([[45, 95, 175], [40, 120, 80], [80, 85, 95], [35, 70, 140], [150, 70, 60], [60, 120, 160], [95, 60, 140]])
    img = np.ones((P, P, 3)) * np.array(base) * rng.uniform(0.7, 1.25)
    img += rng.normal(0, rng.uniform(1, 6), img.shape)
    # lines
    if rng.random() < 0.4:
        c = rng.integers(0, P)
        w = rng.integers(1, 3)
        if rng.random() < 0.5: img[c:c + w, :] = rng.uniform(210, 250)
        else: img[:, c:c + w] = rng.uniform(210, 250)
    # stands / signage texture (yellow ads are the classic false positive)
    if rng.random() < 0.3:
        y0 = rng.integers(0, P)
        col = rng.choice([[230, 200, 40], [240, 220, 60], [30, 160, 120], [200, 40, 60], [250, 250, 250]])
        img[y0:, :] = np.array(col) * rng.uniform(0.7, 1.1) + rng.normal(0, 8, img[y0:, :].shape)
    return img

def blob(img, cx, cy, r, col, blur=(0, 0)):
    yy, xx = np.mgrid[0:P, 0:P]
    n = max(1, int(abs(blur[0]) + abs(blur[1])) + 1)
    acc = np.zeros((P, P))
    for k in range(n):
        f = k / max(1, n - 1) - 0.5
        acc = np.maximum(acc, np.clip(r + 0.5 - np.hypot(xx - (cx + blur[0] * f), yy - (cy + blur[1] * f)), 0, 1))
    a = acc[..., None] * (0.55 if n > 3 else 1.0) ** (n > 6)
    return img * (1 - a) + np.array(col) * a

def ball_col():
    return np.array(rng.choice([[215, 235, 60], [230, 230, 70], [200, 230, 40], [240, 150, 40], [235, 235, 210], [180, 220, 90]])) * rng.uniform(0.75, 1.1)

def sample(pos):
    frames = [court_bg()]
    frames = [frames[0].copy(), frames[0].copy(), frames[0].copy()]
    # camera noise per frame
    for f in frames: f += rng.normal(0, rng.uniform(0.5, 3), f.shape)
    # distractors: players' limbs / shirts / paddles moving
    for _ in range(rng.integers(0, 3)):
        col = rng.choice([[200, 40, 60], [240, 240, 240], [30, 30, 40], [220, 180, 140], [120, 80, 60], [40, 180, 200], [230, 210, 60]])
        r = rng.uniform(2, 9)
        x, y = rng.uniform(-4, P + 4), rng.uniform(-4, P + 4)
        vx, vy = rng.normal(0, 3), rng.normal(0, 3)
        for i in range(3): frames[i] = blob(frames[i], x + vx * (i - 1), y + vy * (i - 1), r, col)
    if pos:
        r = rng.uniform(1.0, 3.2)
        sp = rng.uniform(3, 14)
        a = rng.uniform(0, 2 * math.pi)
        vx, vy = sp * math.cos(a), sp * math.sin(a)
        cx, cy = P / 2 + rng.uniform(-1.5, 1.5), P / 2 + rng.uniform(-1.5, 1.5)
        col = ball_col()
        bl = (vx * rng.uniform(0, 0.5), vy * rng.uniform(0, 0.5))
        for i in range(3):
            if rng.random() < 0.08 and i != 1: continue  # occluded neighbor
            frames[i] = blob(frames[i], cx + vx * (i - 1), cy + vy * (i - 1), r, col, bl)
    else:
        kind = rng.random()
        if kind < 0.35:  # a static yellow thing (sign, shoe) that changes a little
            col = ball_col()
            r = rng.uniform(1, 3)
            for i in range(3): frames[i] = blob(frames[i], P / 2, P / 2, r, col)
        elif kind < 0.6:  # a moving non-ball small thing (paddle edge, hand, shoe)
            col = rng.choice([[30, 30, 40], [220, 180, 140], [240, 240, 240], [200, 40, 60], [60, 60, 200]])
            r = rng.uniform(1.5, 4)
            vx, vy = rng.normal(0, 4), rng.normal(0, 4)
            for i in range(3): frames[i] = blob(frames[i], P / 2 + vx * (i - 1), P / 2 + vy * (i - 1), r, col)
        elif kind < 0.75:  # the ball's ghost: it WAS here last frame (center frame empty)
            col = ball_col()
            r = rng.uniform(1, 3)
            frames[0] = blob(frames[0], P / 2, P / 2, r, col)
        # else: plain background / big moving blob only
    x = np.stack(frames, 0)  # 3, P, P, 3
    return np.clip(x, 0, 255)

def procedural(n):
    X = np.zeros((n, 9, P, P), np.float32)
    Y = np.zeros(n, np.float32)
    for i in range(n):
        pos = i % 2 == 0
        s = sample(pos)
        X[i] = s.transpose(0, 3, 1, 2).reshape(9, P, P) / 255.0
        Y[i] = 1.0 if pos else 0.0
    return X, Y

# ---------- the model ----------
class Scorer(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(9, 12, 3, padding=1)
        self.c2 = nn.Conv2d(12, 16, 3, padding=1)
        self.c3 = nn.Conv2d(16, 24, 3, padding=1)
        self.fc = nn.Linear(24 * 3 * 3, 1)
    def forward(self, x):
        x = torch.relu(self.c1(x)); x = nn.functional.max_pool2d(x, 2)  # 12
        x = torch.relu(self.c2(x)); x = nn.functional.max_pool2d(x, 2)  # 6
        x = torch.relu(self.c3(x)); x = nn.functional.max_pool2d(x, 2)  # 3
        return self.fc(x.flatten(1)).squeeze(1)

def main():
    t0 = time.time()
    cache = os.path.join(HERE, "proc_cache.npz")
    if os.path.exists(cache):
        z = np.load(cache); Xp, Yp, Xv, Yv = z["Xp"], z["Yp"], z["Xv"], z["Yv"]
    else:
        Xp, Yp = procedural(24000)
        Xv, Yv = procedural(4000)
        np.savez(cache, Xp=Xp, Yp=Yp, Xv=Xv, Yv=Yv)
    meta = json.load(open(os.path.join(HERE, "engine_meta.json")))
    ld = lambda n: np.fromfile(os.path.join(HERE, f"engine_{n}.f32"), dtype=np.float32)
    eng = {"Xtr": ld("Xtr").reshape(-1, 9, P, P), "Ytr": ld("Ytr"), "Xte": ld("Xte").reshape(-1, 9, P, P), "Yte": ld("Yte")}
    Xtr = np.concatenate([Xp, eng["Xtr"]]); Ytr = np.concatenate([Yp, eng["Ytr"]])
    # the engine's positives are few: repeat them so they matter
    reps = 6
    Xtr = np.concatenate([Xtr] + [eng["Xtr"][eng["Ytr"] > 0.5]] * reps + [eng["Xtr"][eng["Ytr"] < 0.5]] * 4)
    Ytr = np.concatenate([Ytr] + [eng["Ytr"][eng["Ytr"] > 0.5]] * reps + [eng["Ytr"][eng["Ytr"] < 0.5]] * 4)
    print("data", Xtr.shape, "pos share", Ytr.mean().round(3), "engine test", eng["Xte"].shape, f"{time.time()-t0:.0f}s")
    m = Scorer()
    opt = torch.optim.Adam(m.parameters(), 2e-3)
    lossf = nn.BCEWithLogitsLoss()
    Xt = torch.tensor(Xtr); Yt = torch.tensor(Ytr)
    for ep in range(14):
        perm = torch.randperm(len(Xt))
        m.train(); tot = 0
        for i in range(0, len(Xt), 256):
            idx = perm[i:i + 256]
            xb = Xt[idx]
            # augment: flips, brightness
            if True:
                if torch.rand(1) < 0.5: xb = xb.flip(3)
                if torch.rand(1) < 0.5: xb = xb.flip(2)
                xb = (xb * (0.8 + 0.4 * torch.rand(len(xb), 1, 1, 1))).clamp(0, 1)
            opt.zero_grad(); l = lossf(m(xb), Yt[idx]); l.backward(); opt.step(); tot += l.item() * len(idx)
        m.eval()
        with torch.no_grad():
            pv = torch.sigmoid(m(torch.tensor(Xv))).numpy()
            pe = torch.sigmoid(m(torch.tensor(eng["Xte"]))).numpy()
        def pr(p, y, th=0.5):
            tp = ((p >= th) & (y > 0.5)).sum(); fp = ((p >= th) & (y < 0.5)).sum(); fn = ((p < th) & (y > 0.5)).sum()
            return tp / max(1, tp + fp), tp / max(1, tp + fn)
        print(f"ep {ep} loss {tot/len(Xt):.4f} procedural P/R {pr(pv, Yv)} engine-held-out P/R {pr(pe, eng['Yte'])}")
    # export (the weights first, so an exporter problem can't lose them)
    m.eval()
    torch.save(m.state_dict(), os.path.join(HERE, "scorer.pt"))
    onnx_path = os.path.join(HERE, "realball-scorer.onnx")
    torch.onnx.export(m, torch.zeros(1, 9, P, P), onnx_path, input_names=["patch"], output_names=["logit"], dynamic_axes={"patch": {0: "n"}, "logit": {0: "n"}}, opset_version=17, dynamo=False)
    W = {k: v.detach().numpy().round(5).tolist() for k, v in m.state_dict().items()}
    json.dump({"P": P, "weights": W}, open(os.path.join(HERE, "realball-scorer.json"), "w"))
    # parity check vector for the JS forward pass
    xs = eng["Xte"][:4]
    with torch.no_grad(): ref = m(torch.tensor(xs)).numpy().tolist()
    json.dump({"x": xs.round(4).tolist(), "logit": ref}, open(os.path.join(HERE, "parity.json"), "w"))
    with torch.no_grad():
        pe = torch.sigmoid(m(torch.tensor(eng["Xte"]))).numpy()
    np.save(os.path.join(HERE, "engine_test_scores.npy"), pe)
    print("exported", os.path.getsize(onnx_path), "bytes", f"{time.time()-t0:.0f}s")

if __name__ == "__main__":
    main()
