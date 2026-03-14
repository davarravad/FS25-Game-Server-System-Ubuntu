import json
import os
import re
import subprocess
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


def render_template(content: str, values: dict) -> str:
    out = content
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", str(value))
    return out


@app.before_request
def block_unauthorized():
    if request.path == "/health":
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
    }

    for sub in ["data/config", "data/game", "data/dlc", "data/installer", "data/mods", "data/logs", "data/saves"]:
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081)
