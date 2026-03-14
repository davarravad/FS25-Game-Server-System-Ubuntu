import json
import base64
import hashlib
import hmac
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)

INSTANCE_BASE_PATH = Path(os.getenv("INSTANCE_BASE_PATH", "/opt/fsg-panel/instances"))
BACKUP_BASE_PATH = Path(os.getenv("BACKUP_BASE_PATH", "/opt/fsg-panel/backups"))
AGENT_SHARED_TOKEN = os.getenv("AGENT_SHARED_TOKEN", "")
TEMPLATE_DIR = Path("/app/templates/fs25")


def require_auth():
    token = request.headers.get("X-Agent-Token", "")
    return token == AGENT_SHARED_TOKEN


def safe_instance_id(instance_id: str) -> bool:
    return re.fullmatch(r"[a-zA-Z0-9_-]+", instance_id or "") is not None


def run_command(cmd, cwd=None):
    result = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "command": cmd,
    }


def write_file(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_binary_file(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def render_template(content: str, values: dict) -> str:
    out = content
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", str(value))
    return out


def safe_upload_name(filename: str) -> bool:
    return re.fullmatch(r"[a-zA-Z0-9._ -]+", filename or "") is not None


def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Upload-Token, X-Upload-Filename"
    return response


def ensure_shared_storage(payload):
    shared_paths = [
        Path(payload.get("shared_game_path", "/opt/fs25/game")),
        Path(payload.get("shared_dlc_path", "/opt/fs25/dlc")),
        Path(payload.get("shared_installer_path", "/opt/fs25/installer")),
    ]

    for path in shared_paths:
        path.mkdir(parents=True, exist_ok=True)

    return {
        "game": str(shared_paths[0]),
        "dlc": str(shared_paths[1]),
        "installer": str(shared_paths[2]),
    }


def decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def verify_upload_token(token: str, filename: str, target: str):
    if "." not in token:
        return False, "invalid token"

    payload_encoded, signature_encoded = token.split(".", 1)
    expected_signature = hmac.new(
        AGENT_SHARED_TOKEN.encode("utf-8"),
        payload_encoded.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    try:
        provided_signature = decode_base64url(signature_encoded)
        payload = json.loads(decode_base64url(payload_encoded).decode("utf-8"))
    except Exception:
        return False, "invalid token"

    if not hmac.compare_digest(expected_signature, provided_signature):
        return False, "invalid token signature"

    if payload.get("filename") != filename:
        return False, "filename mismatch"

    if payload.get("target") != target:
        return False, "invalid target"

    if int(payload.get("exp", 0)) < int(time.time()):
        return False, "token expired"

    return True, payload


def part_path_for(destination: Path) -> Path:
    return destination.with_name(destination.name + ".part")


@app.before_request
def block_unauthorized():
    if request.method == "OPTIONS" and request.path == "/host/upload/stream":
        response = jsonify({"ok": True})
        return add_cors_headers(response)
    if request.path == "/health":
        return None
    if request.path == "/host/upload/stream":
        return None
    if not require_auth():
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    return None


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/instance/create")
def create_instance():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    instance_dir = INSTANCE_BASE_PATH / instance_id
    if instance_dir.exists():
        return jsonify({"ok": False, "error": "instance already exists"}), 409

    values = {
        "INSTANCE_ID": instance_id,
        "SERVER_NAME": payload.get("server_name", instance_id),
        "SERVER_PASSWORD": payload.get("server_password", ""),
        "SERVER_ADMIN": payload.get("server_admin", ""),
        "SERVER_PLAYERS": payload.get("server_players", 16),
        "SERVER_PORT": payload.get("server_port", 10823),
        "WEB_PORT": payload.get("web_port", 18000),
        "VNC_PORT": payload.get("vnc_port", 5900),
        "NOVNC_PORT": payload.get("novnc_port", 6080),
        "SERVER_REGION": payload.get("server_region", "en"),
        "SERVER_MAP": payload.get("server_map", "MapUS"),
        "SERVER_DIFFICULTY": payload.get("server_difficulty", 3),
        "SERVER_PAUSE": payload.get("server_pause", 2),
        "SERVER_SAVE_INTERVAL": payload.get("server_save_interval", 180.000000),
        "SERVER_STATS_INTERVAL": payload.get("server_stats_interval", 31536000),
        "SERVER_CROSSPLAY": str(payload.get("server_crossplay", True)).lower(),
        "AUTOSTART_SERVER": str(payload.get("autostart_server", False)).lower(),
        "PUID": payload.get("puid", 1000),
        "PGID": payload.get("pgid", 1000),
        "VNC_PASSWORD": payload.get("vnc_password", "changeme"),
        "WEB_USERNAME": payload.get("web_username", "admin"),
        "WEB_PASSWORD": payload.get("web_password", "changeme"),
        "IMAGE_NAME": payload.get("image_name", "toetje585/arch-fs25server:latest"),
        "INSTANCE_BASE_PATH": str(INSTANCE_BASE_PATH),
        "SHARED_GAME_PATH": payload.get("shared_game_path", "/opt/fs25/game"),
        "SHARED_DLC_PATH": payload.get("shared_dlc_path", "/opt/fs25/dlc"),
        "SHARED_INSTALLER_PATH": payload.get("shared_installer_path", "/opt/fs25/installer"),
    }

    ensure_shared_storage(payload)

    for sub in ["data/config", "data/mods", "data/logs", "data/saves"]:
        (instance_dir / sub).mkdir(parents=True, exist_ok=True)

    compose_tpl = (TEMPLATE_DIR / "compose.instance.yml.tpl").read_text(encoding="utf-8")
    env_tpl = (TEMPLATE_DIR / "server.env.tpl").read_text(encoding="utf-8")

    write_file(instance_dir / "compose.yml", render_template(compose_tpl, values))
    write_file(instance_dir / ".env", render_template(env_tpl, values))

    return jsonify({"ok": True, "instance_dir": str(instance_dir)})


@app.post("/instance/action")
def instance_action():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()
    action = payload.get("action", "").strip().lower()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    instance_dir = INSTANCE_BASE_PATH / instance_id
    compose_file = instance_dir / "compose.yml"

    if not compose_file.exists():
        return jsonify({"ok": False, "error": "instance compose file not found"}), 404

    action_map = {
        "start": ["docker", "compose", "-f", str(compose_file), "up", "-d"],
        "stop": ["docker", "compose", "-f", str(compose_file), "stop"],
        "restart": ["docker", "compose", "-f", str(compose_file), "restart"],
        "pull": ["docker", "compose", "-f", str(compose_file), "pull"],
        "rebuild": ["docker", "compose", "-f", str(compose_file), "up", "-d", "--force-recreate"],
        "down": ["docker", "compose", "-f", str(compose_file), "down"],
        "logs": ["docker", "compose", "-f", str(compose_file), "logs", "--tail", "200"],
    }

    if action not in action_map:
        return jsonify({"ok": False, "error": "unsupported action"}), 400

    result = run_command(action_map[action], cwd=str(instance_dir))
    return jsonify({"ok": True, "result": result})


@app.post("/instance/delete")
def delete_instance():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    instance_dir = INSTANCE_BASE_PATH / instance_id
    compose_file = instance_dir / "compose.yml"

    if compose_file.exists():
        run_command(["docker", "compose", "-f", str(compose_file), "down"], cwd=str(instance_dir))

    if instance_dir.exists():
        for root, dirs, files in os.walk(instance_dir, topdown=False):
            for file in files:
                Path(root, file).unlink(missing_ok=True)
            for d in dirs:
                Path(root, d).rmdir()
        instance_dir.rmdir()

    return jsonify({"ok": True})


@app.post("/instance/upload")
def upload_instance_file():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()
    target = payload.get("target", "").strip().lower()
    filename = payload.get("filename", "").strip()
    file_content = payload.get("content_base64", "").strip()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    if not safe_upload_name(filename):
        return jsonify({"ok": False, "error": "invalid filename"}), 400

    target_map = {
        "mods": "data/mods",
        "saves": "data/saves",
        "config": "data/config",
    }

    if target not in target_map:
        return jsonify({"ok": False, "error": "unsupported upload target"}), 400

    instance_dir = INSTANCE_BASE_PATH / instance_id
    if not instance_dir.exists():
        return jsonify({"ok": False, "error": "instance not found"}), 404

    try:
        decoded = base64.b64decode(file_content, validate=True)
    except Exception:
        return jsonify({"ok": False, "error": "invalid file payload"}), 400

    destination = instance_dir / target_map[target] / filename
    write_binary_file(destination, decoded)

    return jsonify({
        "ok": True,
        "path": str(destination),
        "size": len(decoded),
    })


@app.post("/host/storage/prepare")
def prepare_host_storage():
    payload = request.get_json(force=True)
    paths = ensure_shared_storage(payload)
    return jsonify({"ok": True, "paths": paths})


@app.post("/host/upload")
def upload_host_file():
    payload = request.get_json(force=True)
    target = payload.get("target", "").strip().lower()
    filename = payload.get("filename", "").strip()
    file_content = payload.get("content_base64", "").strip()

    if not safe_upload_name(filename):
        return jsonify({"ok": False, "error": "invalid filename"}), 400

    target_map = {
        "game": Path(payload.get("shared_game_path", "/opt/fs25/game")),
        "dlc": Path(payload.get("shared_dlc_path", "/opt/fs25/dlc")),
        "installer": Path(payload.get("shared_installer_path", "/opt/fs25/installer")),
    }

    if target not in target_map:
        return jsonify({"ok": False, "error": "unsupported upload target"}), 400

    try:
        decoded = base64.b64decode(file_content, validate=True)
    except Exception:
        return jsonify({"ok": False, "error": "invalid file payload"}), 400

    destination_root = target_map[target]
    destination_root.mkdir(parents=True, exist_ok=True)
    destination = destination_root / filename
    write_binary_file(destination, decoded)

    return jsonify({
        "ok": True,
        "path": str(destination),
        "size": len(decoded),
    })


@app.post("/host/upload/stream")
def upload_host_file_stream():
    token = request.headers.get("X-Upload-Token", "").strip()
    filename = request.headers.get("X-Upload-Filename", "").strip()
    target = "installer"

    if not safe_upload_name(filename):
        response = jsonify({"ok": False, "error": "invalid filename"})
        return add_cors_headers(response), 400

    is_valid, token_data = verify_upload_token(token, filename, target)
    if not is_valid:
        response = jsonify({"ok": False, "error": token_data})
        return add_cors_headers(response), 401

    destination_root = Path(str(token_data.get("path", os.getenv("SHARED_INSTALLER_PATH", "/opt/fs25/installer"))))
    destination_root.mkdir(parents=True, exist_ok=True)
    destination = destination_root / filename

    fd, temp_name = tempfile.mkstemp(prefix="upload_", dir=str(destination_root))
    bytes_written = 0

    try:
        with os.fdopen(fd, "wb") as temp_file:
            while True:
                chunk = request.stream.read(1024 * 1024)
                if not chunk:
                    break
                temp_file.write(chunk)
                bytes_written += len(chunk)

        os.replace(temp_name, destination)
    except Exception as exc:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        response = jsonify({"ok": False, "error": f"upload failed: {exc}"})
        return add_cors_headers(response), 500

    response = jsonify({
        "ok": True,
        "path": str(destination),
        "size": bytes_written,
    })
    return add_cors_headers(response)


@app.post("/host/upload/chunk")
def upload_host_file_chunk():
    token = request.headers.get("X-Upload-Token", "").strip()
    filename = request.headers.get("X-Upload-Filename", "").strip()
    target = "installer"

    try:
        offset = int(request.headers.get("X-Upload-Offset", "0").strip())
        total_size = int(request.headers.get("X-Upload-Total-Size", "0").strip())
        is_last_chunk = request.headers.get("X-Upload-Is-Last", "0").strip() == "1"
    except ValueError:
        return jsonify({"ok": False, "error": "invalid chunk metadata"}), 400

    if not safe_upload_name(filename):
        return jsonify({"ok": False, "error": "invalid filename"}), 400

    is_valid, token_data = verify_upload_token(token, filename, target)
    if not is_valid:
        return jsonify({"ok": False, "error": token_data}), 401

    destination_root = Path(str(token_data.get("path", os.getenv("SHARED_INSTALLER_PATH", "/opt/fs25/installer"))))
    destination_root.mkdir(parents=True, exist_ok=True)
    destination = destination_root / filename
    temp_destination = part_path_for(destination)

    chunk = request.get_data(cache=False, as_text=False)
    if chunk is None:
        return jsonify({"ok": False, "error": "missing chunk payload"}), 400

    temp_destination.parent.mkdir(parents=True, exist_ok=True)

    current_size = temp_destination.stat().st_size if temp_destination.exists() else 0
    if current_size != offset:
        return jsonify({
            "ok": False,
            "error": "chunk offset mismatch",
            "expected_offset": current_size,
        }), 409

    with open(temp_destination, "ab") as upload_file:
        upload_file.write(chunk)

    written_size = temp_destination.stat().st_size

    if is_last_chunk:
        if total_size > 0 and written_size != total_size:
            return jsonify({
                "ok": False,
                "error": "final size mismatch",
                "written_size": written_size,
                "expected_size": total_size,
            }), 409

        os.replace(temp_destination, destination)

    return jsonify({
        "ok": True,
        "received_offset": offset,
        "written_size": written_size,
        "completed": is_last_chunk,
        "path": str(destination if is_last_chunk else temp_destination),
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081)
