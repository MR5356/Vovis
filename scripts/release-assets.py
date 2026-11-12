"""Stage native Tauri bundles and assemble the signed GitHub updater manifest."""
import base64
from datetime import datetime, timezone
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


def packages(platform):
    system = platform.split("-")[0]
    pattern, suffix = bundles[system]
    yield platform, pattern, suffix
    if system == "linux":
        # Preserve the old AppImage target for existing clients, while installed
        # Debian clients select the more specific OS-ARCH-deb updater target.
        yield f"{platform}-deb", "deb/*.deb", ".deb"


def version():
    tag = os.environ["GITHUB_REF_NAME"]
    if not re.fullmatch(r"v(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2}", tag):
        raise ValueError("Use a stable version tag, e.g. v1.2.3")
    return tag[1:]


def asset_name(platform, suffix):
    return f"Vovis-{version()}-{platform}{suffix}"


def release_notes():
    path = Path("release-notes") / f"{version()}.md"
    if not path.is_file():
        raise ValueError(f"发布前必须填写更新日志：{path}")
    notes = path.read_text(encoding="utf-8").strip()
    # A version heading or an empty template is not a changelog.
    content = re.sub(r"<!--.*?-->", "", notes, flags=re.S)
    content = re.sub(r"^\s*#.*$", "", content, flags=re.M).strip()
    lines = [re.sub(r"^\s*(?:[-*+]|\d+[.)])(?:\s+|$)", "", line).strip() for line in content.splitlines()]
    if not any(line and not re.fullmatch(r"(?:TODO|TBD|待填写|待补充)[.!。！\s]*", line, re.I) for line in lines):
        raise ValueError(f"更新日志不能为空或仅含占位文本：{path}")
    return notes


def configure():
    release_notes()
    Path("release.conf.json").write_text(json.dumps({"version": version(), "bundle": {"createUpdaterArtifacts": True}}), encoding="utf-8")


def stage(platform, directory):
    if platform not in platforms:
        raise ValueError(platform)
    system = platform.split("-")[0]
    out = Path("release-assets")
    out.mkdir(exist_ok=True)
    for _, pattern, suffix in packages(platform):
        source, = directory.glob(pattern)
        name = asset_name(platform, suffix)
        shutil.copy2(source, out / name)
        shutil.copyfile(str(source) + ".sig", out / (name + ".sig"))
    if system == "darwin":
        dmg, = directory.glob("dmg/*.dmg")
        shutil.copyfile(dmg, out / asset_name(platform, ".dmg"))


def manifest(out):
    notes = release_notes()
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
            if system == "darwin" and not (out / asset_name(platform, ".dmg")).stat().st_size:
                raise ValueError(f"Empty {platform} disk image")
            for target, _, suffix in packages(platform):
                name = asset_name(platform, suffix)
                if not (out / name).stat().st_size:
                    raise ValueError(f"Empty package: {name}")
                signature = (out / (name + ".sig")).read_text().strip()
                sig.write_bytes(base64.b64decode(signature, validate=True))
                subprocess.run(["minisign", "-Vm", str(out / name), "-p", str(public), "-x", str(sig)], check=True)
                trusted = next(line for line in sig.read_text().splitlines() if line.startswith("trusted comment: "))
                if f"version:{version()}" not in trusted.split("\t"):
                    raise ValueError(f"Signed version does not match {tag}: {name}")
                entries[target] = {"signature": signature, "url": f"https://github.com/{repo}/releases/download/{tag}/{name}"}
    (out / "latest.json").write_text(json.dumps({
        "version": version(),
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "platforms": entries,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "configure":
        configure()
    elif command == "notes":
        notes = release_notes() + "\n"
        if args:
            Path(args[0]).write_text(notes, encoding="utf-8")
    elif command == "stage":
        stage(args[0], Path(args[1]))
    elif command == "manifest":
        manifest(Path(args[0]))
    else:
        raise ValueError(command)
