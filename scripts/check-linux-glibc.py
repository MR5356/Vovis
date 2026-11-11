"""Reject release packages whose ELF dependencies exceed Ubuntu 22.04's GLIBC."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys
import tempfile

BASELINE = (2, 35)


def unsupported_versions(output):
    # Definitions describe symbols provided by a library, not its requirements.
    needs = output.partition("Version needs section")[2]
    versions = set(re.findall(r"Name: (GLIBC_[\w.]+)", needs))
    return sorted(
        version for version in versions
        if not re.fullmatch(r"GLIBC_\d+(?:\.\d+)+", version)
        or tuple(map(int, version.removeprefix("GLIBC_").split("."))) > BASELINE
    )


def check_tree(root):
    checked = 0
    failures = []
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open("rb") as file:
            if file.read(4) != b"\x7fELF":
                continue
        checked += 1
        result = subprocess.run(
            ["readelf", "--version-info", str(path)],
            check=True, capture_output=True, text=True,
            env={**os.environ, "LC_ALL": "C"},
        )
        versions = unsupported_versions(result.stdout)
        if versions:
            failures.append(f"{path.relative_to(root)}: {', '.join(versions)}")
    if not checked:
        raise ValueError(f"No ELF files found in {root}")
    if failures:
        raise ValueError("GLIBC 2.35 baseline exceeded:\n" + "\n".join(failures))
    print(f"Verified {checked} ELF files against GLIBC 2.35")


def main(directory):
    appimage, = directory.glob("appimage/*.AppImage")
    deb, = directory.glob("deb/*.deb")
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        subprocess.run([str(appimage.resolve()), "--appimage-extract"], cwd=root,
                       check=True, stdout=subprocess.DEVNULL)
        check_tree(root / "squashfs-root")
        # Check the runtime as well as the libraries inside the AppImage.
        runtime = root / "runtime"
        runtime.mkdir()
        shutil.copyfile(appimage, runtime / "AppImage")
        check_tree(runtime)
        subprocess.run(["dpkg-deb", "-x", str(deb.resolve()), str(root / "deb")], check=True)
        check_tree(root / "deb")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
