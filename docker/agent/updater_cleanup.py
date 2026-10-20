"""Clears the game's updater download folder for one server.

The dedicated server's updater keeps its downloaded patch files in the profile's `updater` folder. A half-finished
download there can make every later update attempt hang or fail until the files are removed.
"""
import os
import shutil
from pathlib import Path

PROFILE_RELATIVE_PATH = "data/config/FarmingSimulator2025"
UPDATER_FOLDER_NAME = "updater"


def clear_updater_folder(instance_dir: Path) -> dict:
    """Delete everything inside <instance>/data/config/FarmingSimulator2025/updater, keeping the folder itself.

    Only that one folder is ever touched: the folder must be a real directory directly inside the profile folder,
    and symbolic links inside it are unlinked rather than followed so nothing outside it can be deleted.
    """
    profile = instance_dir / PROFILE_RELATIVE_PATH
    updater = profile / UPDATER_FOLDER_NAME

    if updater.is_symlink():
        return {"ok": False, "error": "The updater folder is a symbolic link; refusing to clear it."}
    if not updater.exists():
        return {"ok": True, "removed_items": 0, "removed_bytes": 0, "message": "The updater folder does not exist; nothing to clear."}
    if not updater.is_dir():
        return {"ok": False, "error": "The updater path is not a folder; refusing to clear it."}
    if updater.resolve().parent != profile.resolve():
        return {"ok": False, "error": "The updater folder resolves outside the server profile; refusing to clear it."}

    removed_items = 0
    removed_bytes = 0
    errors = []

    def forget_error(func, failed_path, exc_info):
        # Wine may leave read-only files behind; retry once with write permission before giving up.
        failed = Path(failed_path)
        try:
            os.chmod(failed, 0o775 if failed.is_dir() and not failed.is_symlink() else 0o664)
            func(failed_path)
        except Exception as exc:
            errors.append(f"{failed_path}: {exc}")

    for entry in os.scandir(updater):
        path = Path(entry.path)
        try:
            if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
                size = 0 if entry.is_symlink() else entry.stat(follow_symlinks=False).st_size
                try:
                    path.unlink()
                except PermissionError:
                    os.chmod(path, 0o664)
                    path.unlink()
                removed_bytes += size
            else:
                for root, _dirs, files in os.walk(path, followlinks=False):
                    for name in files:
                        file_path = Path(root, name)
                        if not file_path.is_symlink():
                            removed_bytes += file_path.lstat().st_size
                shutil.rmtree(path, onerror=forget_error)
            removed_items += 1
        except Exception as exc:
            errors.append(f"{path}: {exc}")

    if errors:
        return {"ok": False, "error": "; ".join(errors)[:500], "removed_items": removed_items, "removed_bytes": removed_bytes}
    return {"ok": True, "removed_items": removed_items, "removed_bytes": removed_bytes}
