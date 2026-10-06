"""Builds LAN Party 98's game bundles (client/public/emu/games/*.jsdos) from the official
shareware releases on the /idgames archive, unmodified, plus a DOSBox config.

  python tools/lanparty/build_bundles.py [download-dir]

Each release is a DEICE installer: two split parts of a PKLITE self-extractor whose payload
is a plain ZIP. We join the parts, find the ZIP and copy its files as they are, so the
bundle holds exactly what the shareware installer would put on the disk (the readmes and
order forms included, as the shareware terms ask: "please distribute" / "freely
distribute", unmodified). The [autoexec] mounts the drive and calls LAUNCH.BAT, which isn't in the
bundle: LAN Party 98 writes it per launch (play alone, host or join a LAN game) through
js-dos's initFs, so the game files stay exactly as released.
"""
import io
import os
import sys
import urllib.request
import zipfile

MIRROR = "https://youfailit.net/pub/idgames/idstuff/"
GAMES = {
    # id: (archive path, part names, folder)
    "doom": ("doom/doom19s.zip", ["DOOMS_19.1", "DOOMS_19.2"]),
    "heretic": ("heretic/htic_v12.zip", ["HTIC_V12.1", "HTIC_V12.2"]),
}

CONF = """[sdl]
autolock=true
usescancodes=true
[dosbox]
machine=svga_s3
memsize=16
[cpu]
core=auto
cputype=auto
cycles=auto
[mixer]
rate=44100
blocksize=1024
prebuffer=20
[render]
frameskip=0
aspect=false
scaler=none
[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
[speaker]
pcspeaker=true
[dos]
xms=true
ems=true
umb=true
[ipx]
ipx=true
[autoexec]
echo off
mount c .
c:
if exist LAUNCH.BAT call LAUNCH.BAT
"""

README = "LAN Party 98 bundle: the unmodified shareware release from the /idgames archive ({src}).\r\n"


def payload(data):
    at = data.find(b"PK\x03\x04")
    if at < 0:
        raise SystemExit("no ZIP payload found")
    return zipfile.ZipFile(io.BytesIO(data[at:]))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "..", "client", "public", "emu", "games")
    os.makedirs(out, exist_ok=True)
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, ".cache")
    os.makedirs(cache, exist_ok=True)
    for gid, (path, parts) in GAMES.items():
        local = os.path.join(cache, os.path.basename(path))
        if not os.path.exists(local):
            print("downloading", MIRROR + path)
            urllib.request.urlretrieve(MIRROR + path, local)
        outer = zipfile.ZipFile(local)
        inner = payload(b"".join(outer.read(p) for p in parts))
        dest = os.path.join(out, gid + ".jsdos")
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for info in inner.infolist():
                z.writestr(info.filename, inner.read(info.filename))
            z.writestr(".jsdos/dosbox.conf", CONF)
            z.writestr(".jsdos/readme.txt", README.format(src=MIRROR + path))
        print(gid, os.path.getsize(dest), "bytes,", len(inner.infolist()), "files")


if __name__ == "__main__":
    main()
