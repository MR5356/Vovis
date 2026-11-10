"""Stage native Tauri bundles and assemble the signed GitHub updater manifest."""
import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

# The updater looks up this platform key on the client.
bundles = {
    "darwin": ("macos/*.app.tar.gz", ".app.tar.gz"),
    "windows": ("nsis/*-setup.exe", "-setup.exe"),
    "linux": ("appimage/*.AppImage", ".AppImage"),
}
platforms = [f"{system}-{arch}" for system in bundles for arch in ("aarch64", "x86_64")]


def version():
    tag = os.environ["GITHUB_REF_NAME"]
    if not re.fullmatch(r"v(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2}", tag):
        raise ValueError("Use a stable version tag, e.g. v1.2.3")
    return tag[1:]


def asset_name(platform, suffix):
    return f"Vovis-{version()}-{platform}{suffix}"


def stage(platform, directory):
    if platform not in platforms:
        raise ValueError(platform)
    system = platform.split("-")[0]
    pattern, suffix = bundles[system]
    source, = directory.glob(pattern)
    out = Path("release-assets")
    out.mkdir(exist_ok=True)
    name = asset_name(platform, suffix)
    shutil.copyfile(source, out / name)
    shutil.copyfile(str(source) + ".sig", out / (name + ".sig"))
    if system == "darwin":
        dmg, = directory.glob("dmg/*.dmg")
        shutil.copyfile(dmg, out / asset_name(platform, ".dmg"))


def manifest(out):
    config = json.loads(Path("src-tauri/tauri.conf.json").read_text())
    entries = {}
    tag = os.environ["GITHUB_REF_NAME"]
    repo = os.environ["GITHUB_REPOSITORY"]
    with tempfile.TemporaryDirectory() as temp:
        public = Path(temp) / "public.key"
        public.write_bytes(base64.b64decode(config["plugins"]["updater"]["pubkey"], validate=True))
        sig = Path(temp) / "minisign.sig"
        for platform in platforms:
            system = platform.split("-")[0]
            name = asset_name(platform, bundles[system][1])
            if system == "darwin" and not (out / asset_name(platform, ".dmg")).stat().st_size:
                raise ValueError(f"Empty {platform} disk image")
            signature = (out / (name + ".sig")).read_text().strip()
            sig.write_bytes(base64.b64decode(signature, validate=True))
            subprocess.run(["minisign", "-Vm", str(out / name), "-p", str(public), "-x", str(sig)], check=True)
            trusted = next(line for line in sig.read_text().splitlines() if line.startswith("trusted comment: "))
            if f"version:{version()}" not in trusted.split("\t"):
                raise ValueError(f"Signed version does not match {tag}: {name}")
            entries[platform] = {"signature": signature, "url": f"https://github.com/{repo}/releases/download/{tag}/{name}"}
    (out / "latest.json").write_text(json.dumps({"version": version(), "platforms": entries}, indent=2) + "\n")


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "configure":
        Path("release.conf.json").write_text(json.dumps({"version": version(), "bundle": {"createUpdaterArtifacts": True}}))
    elif command == "stage":
        stage(args[0], Path(args[1]))
    elif command == "manifest":
        manifest(Path(args[0]))
    else:
        raise ValueError(command)
