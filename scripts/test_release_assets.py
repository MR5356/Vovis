import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


release = load_script("release-assets")
glibc = load_script("check-linux-glibc")


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        previous = Path.cwd()
        os.chdir(self.temp.name)
        self.addCleanup(os.chdir, previous)
        env = patch.dict(os.environ, GITHUB_REF_NAME="v1.2.3", GITHUB_REPOSITORY="example/Vovis")
        env.start()
        self.addCleanup(env.stop)

    def test_linux_stages_both_installers_and_requires_both_signatures(self):
        directory = Path("bundle")
        for folder, suffix in [("appimage", ".AppImage"), ("deb", ".deb")]:
            path = directory / folder / ("vovis" + suffix)
            path.parent.mkdir(parents=True)
            path.write_bytes(b"package")
            Path(str(path) + ".sig").write_text("signature")
        release.stage("linux-x86_64", directory)
        self.assertEqual(
            {p.name for p in Path("release-assets").iterdir()},
            {f"Vovis-1.2.3-linux-x86_64{suffix}" for suffix in [".AppImage", ".AppImage.sig", ".deb", ".deb.sig"]},
        )
        (directory / "deb/vovis.deb.sig").unlink()
        with self.assertRaises(FileNotFoundError):
            release.stage("linux-x86_64", directory)

    def prepare_manifest(self):
        Path("src-tauri").mkdir()
        Path("src-tauri/tauri.conf.json").write_text(json.dumps({
            "plugins": {"updater": {"pubkey": base64.b64encode(b"test key").decode()}}
        }))
        out = Path("release-assets")
        out.mkdir()
        signature = base64.b64encode(b"trusted comment: timestamp:1\tversion:1.2.3\n").decode()
        for platform in release.platforms:
            for _, _, suffix in release.packages(platform):
                name = release.asset_name(platform, suffix)
                (out / name).write_bytes(b"package")
                (out / (name + ".sig")).write_text(signature)
            if platform.startswith("darwin"):
                (out / release.asset_name(platform, ".dmg")).write_bytes(b"dmg")
        return out

    def test_manifest_routes_deb_clients_without_breaking_appimage_clients(self):
        out = self.prepare_manifest()
        with patch.object(release.subprocess, "run") as verify:
            release.manifest(out)
        manifest = json.loads((out / "latest.json").read_text())
        self.assertEqual(len(manifest["platforms"]), 8)
        self.assertEqual(verify.call_count, 8)
        for arch in ("aarch64", "x86_64"):
            for target, suffix in [(f"linux-{arch}", ".AppImage"), (f"linux-{arch}-deb", ".deb")]:
                self.assertTrue(manifest["platforms"][target]["url"].endswith(f"Vovis-1.2.3-linux-{arch}{suffix}"))

    def test_manifest_rejects_mismatched_signed_deb_version(self):
        out = self.prepare_manifest()
        signature = out / (release.asset_name("linux-aarch64", ".deb") + ".sig")
        signature.write_text(base64.b64encode(b"trusted comment: timestamp:1\tversion:1.0.0\n").decode())
        with patch.object(release.subprocess, "run"), self.assertRaisesRegex(ValueError, "Signed version"):
            release.manifest(out)
        self.assertFalse((out / "latest.json").exists())


class GlibcTests(unittest.TestCase):
    def test_checks_required_versions_not_exported_symbols(self):
        self.assertEqual(glibc.unsupported_versions("""
Version definition section '.gnu.version_d':
  Name: GLIBC_2.39
Version needs section '.gnu.version_r':
  Name: GLIBC_2.2.5
  Name: GLIBC_2.35
"""), [])

    def test_rejects_reported_glibc_versions_and_new_abi_requirements(self):
        self.assertEqual(glibc.unsupported_versions("""
Version needs section '.gnu.version_r':
  Name: GLIBC_2.38
  Name: GLIBC_2.39
  Name: GLIBC_ABI_DT_RELR
"""), ["GLIBC_2.38", "GLIBC_2.39", "GLIBC_ABI_DT_RELR"])


if __name__ == "__main__":
    unittest.main()
