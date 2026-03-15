import json
import base64
import hashlib
import hmac
import os
import re
import shutil
import subprocess
import tempfile
import time
from contextlib import suppress
from pathlib import Path

from flask import Flask, jsonify, request

app = Flask(__name__)

INSTANCE_BASE_PATH = Path(os.getenv("INSTANCE_BASE_PATH", "/opt/fsg-panel/instances"))
BACKUP_BASE_PATH = Path(os.getenv("BACKUP_BASE_PATH", "/opt/fsg-panel/backups"))
AGENT_SHARED_TOKEN = os.getenv("AGENT_SHARED_TOKEN", "")
TEMPLATE_DIR = Path("/app/templates/fs25")
FS25_RUNTIME_SOURCE = Path(os.getenv("FS25_RUNTIME_SOURCE", "/app/fs25-runtime"))
FS25_RUNTIME_IMAGE = os.getenv("FS25_RUNTIME_IMAGE", "fsg/fs25-runtime:local")
FS25_RUNTIME_RELEASETAG = os.getenv("FS25_RUNTIME_RELEASETAG", "local")
FS25_RUNTIME_TARGETARCH = os.getenv("FS25_RUNTIME_TARGETARCH", "amd64")
STATE_FILE_NAME = ".panel-state.json"
SFTP_UID = int(os.getenv("SFTP_UID", "1000"))
SFTP_GID = int(os.getenv("SFTP_GID", "1000"))
COMPOSE_COMMAND = None


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


def compose_command():
    global COMPOSE_COMMAND

    if COMPOSE_COMMAND is not None:
        return COMPOSE_COMMAND

    docker_path = shutil.which("docker")
    if docker_path:
        probe = run_command([docker_path, "compose", "version"])
        if probe["code"] == 0:
            COMPOSE_COMMAND = [docker_path, "compose"]
            return COMPOSE_COMMAND

    docker_compose_path = shutil.which("docker-compose")
    if docker_compose_path:
        COMPOSE_COMMAND = [docker_compose_path]
        return COMPOSE_COMMAND

    COMPOSE_COMMAND = ["docker", "compose"]
    return COMPOSE_COMMAND


def compose_cmd(*args):
    return [*compose_command(), *args]


def canonical_image_name(image_name: str) -> str:
    normalized = (image_name or "").strip()
    if normalized in {"", "toetje585/arch-fs25server:latest", "fsg/fs25-runtime", "fsg/fs25-runtime:latest"}:
        return FS25_RUNTIME_IMAGE
    return normalized


def image_exists(image_name: str) -> bool:
    result = run_command(["docker", "image", "inspect", image_name])
    return result["code"] == 0


def runtime_target_arch() -> str:
    host_arch = os.uname().machine.lower()
    arch_map = {
        "x86_64": "amd64",
        "amd64": "amd64",
        "aarch64": "arm64",
        "arm64": "arm64",
    }
    return FS25_RUNTIME_TARGETARCH or arch_map.get(host_arch, host_arch)


def ensure_runtime_image(image_name: str, force_rebuild: bool = False) -> dict:
    image_name = canonical_image_name(image_name)
    if image_name != FS25_RUNTIME_IMAGE:
        return {"ok": True, "skipped": True}

    if not FS25_RUNTIME_SOURCE.exists():
        return {"ok": False, "error": f"runtime source not found at {FS25_RUNTIME_SOURCE}"}

    if not force_rebuild and image_exists(image_name):
        return {"ok": True, "built": False}

    build_cmd = [
        "docker", "build",
        "-t", image_name,
        "--build-arg", f"RELEASETAG={FS25_RUNTIME_RELEASETAG}",
        "--build-arg", f"TARGETARCH={runtime_target_arch()}",
        str(FS25_RUNTIME_SOURCE),
    ]
    result = run_command(build_cmd)
    response = {"ok": result["code"] == 0, "result": result}
    if result["code"] != 0:
        response["error"] = (result.get("stderr") or result.get("stdout") or "Image build failed").strip()
    return response


def image_name_from_compose(compose_file: Path) -> str:
    if not compose_file.exists():
        return FS25_RUNTIME_IMAGE

    for raw_line in compose_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("image:"):
            return canonical_image_name(line.split(":", 1)[1].strip().strip('"').strip("'"))

    return FS25_RUNTIME_IMAGE


def write_file(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_binary_file(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def apply_permissions(path: Path, recursive: bool = True):
    if not path.exists():
        return

    def set_perms(target: Path):
        with suppress(PermissionError, OSError):
            os.chown(target, SFTP_UID, SFTP_GID)
        with suppress(PermissionError, OSError):
            os.chmod(target, 0o775 if target.is_dir() else 0o664)

    set_perms(path)

    if recursive and path.is_dir():
        for root, dirs, files in os.walk(path):
            root_path = Path(root)
            set_perms(root_path)
            for name in dirs:
                set_perms(root_path / name)
            for name in files:
                set_perms(root_path / name)


def render_template(content: str, values: dict) -> str:
    out = content
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", str(value))
    return out


def read_env_file(path: Path) -> dict:
    values = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def build_instance_values(instance_id: str, payload: dict, existing_env: dict | None = None) -> dict:
    existing_env = existing_env or {}

    def current(key: str, default):
        return payload.get(key.lower(), payload.get(key, existing_env.get(key, default)))

    return {
        "INSTANCE_ID": instance_id,
        "SERVER_NAME": current("SERVER_NAME", instance_id),
        "SERVER_PASSWORD": current("SERVER_PASSWORD", ""),
        "SERVER_ADMIN": current("SERVER_ADMIN", ""),
        "SERVER_PLAYERS": current("SERVER_PLAYERS", 16),
        "SERVER_PORT": current("SERVER_PORT", 10823),
        "WEB_PORT": current("WEB_PORT", 18000),
        "VNC_PORT": current("VNC_PORT", 5900),
        "NOVNC_PORT": current("NOVNC_PORT", 6080),
        "SERVER_REGION": current("SERVER_REGION", "en"),
        "SERVER_MAP": current("SERVER_MAP", "MapUS"),
        "SERVER_DIFFICULTY": current("SERVER_DIFFICULTY", 3),
        "SERVER_PAUSE": current("SERVER_PAUSE", 2),
        "SERVER_SAVE_INTERVAL": current("SERVER_SAVE_INTERVAL", 180.000000),
        "SERVER_STATS_INTERVAL": current("SERVER_STATS_INTERVAL", 31536000),
        "SERVER_CROSSPLAY": str(current("SERVER_CROSSPLAY", True)).lower(),
        "AUTOSTART_SERVER": str(current("AUTOSTART_SERVER", False)).lower(),
        "PUID": current("PUID", 1000),
        "PGID": current("PGID", 1000),
        "VNC_PASSWORD": current("VNC_PASSWORD", "changeme"),
        "WEB_USERNAME": current("WEB_USERNAME", "admin"),
        "WEB_PASSWORD": current("WEB_PASSWORD", "changeme"),
        "SFTP_PORT": current("SFTP_PORT", 2222),
        "SFTP_USERNAME": current("SFTP_USERNAME", "fs25"),
        "SFTP_PASSWORD": current("SFTP_PASSWORD", "changeme"),
        "IMAGE_NAME": canonical_image_name(str(current("IMAGE_NAME", FS25_RUNTIME_IMAGE))),
        "INSTANCE_BASE_PATH": str(INSTANCE_BASE_PATH),
        "SHARED_GAME_PATH": current("SHARED_GAME_PATH", "/opt/fs25/game"),
        "SHARED_DLC_PATH": current("SHARED_DLC_PATH", "/opt/fs25/dlc"),
        "SHARED_INSTALLER_PATH": current("SHARED_INSTALLER_PATH", "/opt/fs25/installer"),
    }


def render_instance_files(instance_dir: Path, values: dict, write_env: bool = False):
    compose_tpl = (TEMPLATE_DIR / "compose.instance.yml.tpl").read_text(encoding="utf-8")
    write_file(instance_dir / "compose.yml", render_template(compose_tpl, values))
    write_file(
        instance_dir / "users.conf",
        f"{values['SFTP_USERNAME']}:{values['SFTP_PASSWORD']}:1000:1000:FarmingSimulator2025\n",
    )

    if write_env:
        env_tpl = (TEMPLATE_DIR / "server.env.tpl").read_text(encoding="utf-8")
        write_file(instance_dir / ".env", render_template(env_tpl, values))

    apply_permissions(instance_dir, recursive=True)


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
        apply_permissions(path, recursive=True)

    return {
        "game": str(shared_paths[0]),
        "dlc": str(shared_paths[1]),
        "installer": str(shared_paths[2]),
    }


def instance_state_path(instance_id: str) -> Path:
    return INSTANCE_BASE_PATH / instance_id / STATE_FILE_NAME


def write_instance_state(instance_id: str, desired_running: bool):
    state_path = instance_state_path(instance_id)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps({"desired_running": desired_running, "updated_at": int(time.time())}),
        encoding="utf-8",
    )


def read_instance_state(instance_id: str) -> dict:
    state_path = instance_state_path(instance_id)
    if not state_path.exists():
        return {"desired_running": False}

    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {"desired_running": False}


def restore_desired_instances():
    INSTANCE_BASE_PATH.mkdir(parents=True, exist_ok=True)
    apply_permissions(INSTANCE_BASE_PATH, recursive=True)
    BACKUP_BASE_PATH.mkdir(parents=True, exist_ok=True)
    apply_permissions(BACKUP_BASE_PATH, recursive=True)
    ensure_shared_storage({
        "shared_game_path": os.getenv("SHARED_GAME_PATH", "/opt/fs25/game"),
        "shared_dlc_path": os.getenv("SHARED_DLC_PATH", "/opt/fs25/dlc"),
        "shared_installer_path": os.getenv("SHARED_INSTALLER_PATH", "/opt/fs25/installer"),
    })

    for instance_dir in INSTANCE_BASE_PATH.iterdir():
        if not instance_dir.is_dir():
            continue

        instance_id = instance_dir.name
        compose_file = instance_dir / "compose.yml"
        state = read_instance_state(instance_id)
        apply_permissions(instance_dir, recursive=True)

        if not compose_file.exists() or not bool(state.get("desired_running")):
            continue

        run_command(compose_cmd("-f", str(compose_file), "up", "-d"), cwd=str(instance_dir))


def decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def verify_upload_token(token: str, filename: str, scope: str):
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

    if payload.get("scope") != scope:
        return False, "invalid upload scope"

    if int(payload.get("exp", 0)) < int(time.time()):
        return False, "token expired"

    return True, payload


def part_path_for(destination: Path) -> Path:
    return destination.with_name(destination.name + ".part")


def resolve_subpath(root: Path, subpath: str) -> Path | None:
    clean = (subpath or "").strip().replace("\\", "/")
    candidate = (root / clean).resolve() if clean not in {"", "."} else root.resolve()
    root_resolved = root.resolve()

    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return None

    return candidate


def check_directory_access(root: Path) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    apply_permissions(root, recursive=False)
    readable = os.access(root, os.R_OK)
    writable = False
    error = None
    temp_path = root / f".panel-write-test-{int(time.time() * 1000)}"

    try:
        temp_path.write_text("ok", encoding="utf-8")
        writable = True
    except Exception as exc:
        error = str(exc)
    finally:
        with suppress(OSError):
            temp_path.unlink()

    return {
        "exists": root.exists(),
        "readable": readable,
        "writable": writable,
        "error": error,
    }


def parse_size_to_bytes(value: str) -> int:
    raw = (value or "").strip()
    if raw == "":
        return 0

    match = re.fullmatch(r"([0-9]*\.?[0-9]+)\s*([KMGTP]?i?B)", raw, re.IGNORECASE)
    if not match:
        with suppress(ValueError):
            return int(float(raw))
        return 0

    amount = float(match.group(1))
    unit = match.group(2).upper()
    factors = {
        "B": 1,
        "KB": 1000,
        "MB": 1000 ** 2,
        "GB": 1000 ** 3,
        "TB": 1000 ** 4,
        "KIB": 1024,
        "MIB": 1024 ** 2,
        "GIB": 1024 ** 3,
        "TIB": 1024 ** 4,
    }
    return int(amount * factors.get(unit, 1))


def inspect_container(container_name: str) -> dict:
    result = run_command([
        "docker", "inspect", container_name,
        "--format", "{{json .State}}",
    ])

    if result["code"] != 0 or not result["stdout"].strip():
        return {
            "exists": False,
            "name": container_name,
            "status": "missing",
            "running": False,
            "restarting": False,
            "exit_code": None,
            "started_at": "",
            "finished_at": "",
            "health": None,
        }

    try:
        state = json.loads(result["stdout"].strip())
    except json.JSONDecodeError:
        return {
            "exists": False,
            "name": container_name,
            "status": "unknown",
            "running": False,
            "restarting": False,
            "exit_code": None,
            "started_at": "",
            "finished_at": "",
            "health": None,
        }

    return {
        "exists": True,
        "name": container_name,
        "status": str(state.get("Status") or "unknown"),
        "running": bool(state.get("Running")),
        "restarting": bool(state.get("Restarting")),
        "exit_code": state.get("ExitCode"),
        "started_at": str(state.get("StartedAt") or ""),
        "finished_at": str(state.get("FinishedAt") or ""),
        "health": ((state.get("Health") or {}).get("Status") if isinstance(state.get("Health"), dict) else None),
    }


def derive_runtime_state(containers: list[dict], desired_running: bool) -> dict:
    statuses = {str(container.get("status", "unknown")).lower() for container in containers}
    running_count = sum(1 for container in containers if container.get("running"))
    total = len(containers)
    all_running = total > 0 and running_count == total
    any_running = running_count > 0
    any_booting = any(status in {"created", "restarting", "paused"} for status in statuses)

    if all_running:
        return {
            "state": "online",
            "label": "Online",
            "detail": "All required containers are running.",
        }

    if desired_running and (any_booting or any_running):
        return {
            "state": "booting",
            "label": "Booting",
            "detail": "The server is starting but not all required containers are ready yet.",
        }

    if any_running:
        return {
            "state": "degraded",
            "label": "Degraded",
            "detail": "Some required containers are running, but the full stack is not healthy.",
        }

    return {
        "state": "offline",
        "label": "Offline",
        "detail": "Required containers are not running.",
    }


def instance_metrics(instance_id: str) -> dict:
    instance_dir = INSTANCE_BASE_PATH / instance_id
    compose_file = instance_dir / "compose.yml"
    if not compose_file.exists():
        return {"ok": False, "error": "instance compose file not found"}

    main_container = instance_id
    stats_result = run_command([
        "docker", "stats", main_container, "--no-stream",
        "--format", "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
    ])

    metrics = {
        "cpu_percent": 0.0,
        "memory_used_bytes": 0,
        "memory_limit_bytes": 0,
        "memory_percent": 0.0,
        "disk_used_bytes": 0,
        "disk_percent": 0.0,
        "running": False,
        "desired_running": bool(read_instance_state(instance_id).get("desired_running")),
        "containers": [],
        "runtime_state": {
            "state": "offline",
            "label": "Offline",
            "detail": "Required containers are not running.",
        },
    }

    ps_result = run_command(compose_cmd("-f", str(compose_file), "ps", "--status", "running", "--services"), cwd=str(instance_dir))
    if ps_result["code"] == 0:
        metrics["running"] = "fs25" in [line.strip() for line in ps_result["stdout"].splitlines()]

    containers = [
        {"service": "fs25", **inspect_container(instance_id)},
        {"service": "sftp", **inspect_container(f"{instance_id}-sftp")},
    ]
    metrics["containers"] = containers
    metrics["runtime_state"] = derive_runtime_state(containers, bool(metrics["desired_running"]))
    metrics["running"] = bool(metrics["runtime_state"]["state"] in {"online", "booting", "degraded"} and any(c.get("service") == "fs25" and c.get("running") for c in containers))

    if stats_result["code"] == 0 and stats_result["stdout"].strip():
        raw_cpu, raw_mem, raw_mem_pct = (stats_result["stdout"].strip().split("|") + ["", "", ""])[:3]
        with suppress(ValueError):
            metrics["cpu_percent"] = float(raw_cpu.strip().rstrip("%") or 0)
        with suppress(ValueError):
            metrics["memory_percent"] = float(raw_mem_pct.strip().rstrip("%") or 0)

        parts = [part.strip() for part in raw_mem.split("/") if part.strip()]
        if len(parts) == 2:
            metrics["memory_used_bytes"] = parse_size_to_bytes(parts[0])
            metrics["memory_limit_bytes"] = parse_size_to_bytes(parts[1])

    disk_result = run_command(["du", "-sb", str(instance_dir)])
    if disk_result["code"] == 0 and disk_result["stdout"].strip():
        first = disk_result["stdout"].split()[0]
        with suppress(ValueError):
            metrics["disk_used_bytes"] = int(first)

    fs_result = run_command(["df", "-B1", str(instance_dir)])
    if fs_result["code"] == 0:
        lines = [line for line in fs_result["stdout"].splitlines() if line.strip()]
        if len(lines) >= 2:
            columns = lines[-1].split()
            if len(columns) >= 2:
                with suppress(ValueError):
                    total_bytes = int(columns[1])
                    if total_bytes > 0:
                        metrics["disk_percent"] = round((metrics["disk_used_bytes"] / total_bytes) * 100, 2)

    return {"ok": True, "metrics": metrics}


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

    values = build_instance_values(instance_id, payload)

    ensure_shared_storage(payload)

    for sub in ["data/config", "data/mods", "data/logs", "data/saves"]:
        (instance_dir / sub).mkdir(parents=True, exist_ok=True)
    apply_permissions(instance_dir, recursive=True)

    render_instance_files(instance_dir, values, write_env=True)
    write_instance_state(instance_id, False)

    return jsonify({"ok": True, "instance_dir": str(instance_dir)})


@app.post("/instance/sync")
def sync_instance():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    instance_dir = INSTANCE_BASE_PATH / instance_id
    if not instance_dir.exists():
        return jsonify({"ok": False, "error": "instance not found"}), 404

    existing_env = read_env_file(instance_dir / ".env")
    values = build_instance_values(instance_id, payload, existing_env)
    render_instance_files(instance_dir, values, write_env=False)

    return jsonify({"ok": True, "instance_dir": str(instance_dir)})


@app.post("/instance/secrets")
def instance_secrets():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    instance_dir = INSTANCE_BASE_PATH / instance_id
    env_file = instance_dir / ".env"
    if not env_file.exists():
        return jsonify({"ok": False, "error": "instance env file not found"}), 404

    env_values = read_env_file(env_file)
    return jsonify({
        "ok": True,
        "secrets": {
            "vnc_password": env_values.get("VNC_PASSWORD", ""),
        },
    })


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

    image_name = image_name_from_compose(compose_file)

    if action in {"start", "restart", "rebuild"}:
        image_result = ensure_runtime_image(image_name, force_rebuild=(action == "rebuild"))
        if not image_result.get("ok"):
            return jsonify(image_result), 500

    if action == "pull" and image_name == FS25_RUNTIME_IMAGE:
        image_result = ensure_runtime_image(image_name, force_rebuild=True)
        return jsonify(image_result), (200 if image_result.get("ok") else 500)

    action_map = {
        "start": compose_cmd("-f", str(compose_file), "up", "-d"),
        "stop": compose_cmd("-f", str(compose_file), "stop"),
        "restart": compose_cmd("-f", str(compose_file), "restart"),
        "pull": compose_cmd("-f", str(compose_file), "pull"),
        "rebuild": compose_cmd("-f", str(compose_file), "up", "-d", "--force-recreate"),
        "down": compose_cmd("-f", str(compose_file), "down"),
        "logs": compose_cmd("-f", str(compose_file), "logs", "--tail", "200"),
        "status": compose_cmd("-f", str(compose_file), "ps", "-a"),
    }

    if action not in action_map:
        return jsonify({"ok": False, "error": "unsupported action"}), 400

    result = run_command(action_map[action], cwd=str(instance_dir))

    if result["code"] == 0:
        if action in {"start", "restart", "rebuild"}:
            write_instance_state(instance_id, True)
        elif action in {"stop", "down"}:
            write_instance_state(instance_id, False)

    response = {
        "ok": result["code"] == 0,
        "result": result,
    }
    if result["code"] != 0:
        response["error"] = (result.get("stderr") or result.get("stdout") or "Command failed").strip()

    return jsonify(response), (200 if result["code"] == 0 else 500)


@app.post("/instance/delete")
def delete_instance():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    instance_dir = INSTANCE_BASE_PATH / instance_id
    compose_file = instance_dir / "compose.yml"

    if compose_file.exists():
        run_command(compose_cmd("-f", str(compose_file), "down"), cwd=str(instance_dir))

    if instance_dir.exists():
        for root, dirs, files in os.walk(instance_dir, topdown=False):
            for file in files:
                Path(root, file).unlink(missing_ok=True)
            for d in dirs:
                Path(root, d).rmdir()
        instance_dir.rmdir()

    with suppress(FileNotFoundError):
        instance_state_path(instance_id).unlink()

    return jsonify({"ok": True})


@app.post("/instance/metrics")
def get_instance_metrics():
    payload = request.get_json(force=True)
    instance_id = payload.get("instance_id", "").strip()

    if not safe_instance_id(instance_id):
        return jsonify({"ok": False, "error": "invalid instance id"}), 400

    result = instance_metrics(instance_id)
    status = 200 if result.get("ok") else 404
    return jsonify(result), status


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
        "profile": "data/config",
        "mods": "data/mods",
        "saves": "data/saves",
        "config": "data/config",
        "logs": "data/logs",
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
    apply_permissions(INSTANCE_BASE_PATH, recursive=True)
    apply_permissions(BACKUP_BASE_PATH, recursive=True)
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
    apply_permissions(destination_root, recursive=True)

    return jsonify({
        "ok": True,
        "path": str(destination),
        "size": len(decoded),
    })


@app.post("/host/installer/unzip")
def unzip_installer_archive():
    payload = request.get_json(force=True)
    filename = payload.get("filename", "").strip()
    installer_root = Path(payload.get("shared_installer_path", os.getenv("SHARED_INSTALLER_PATH", "/opt/fs25/installer")))

    archive_path = resolve_subpath(installer_root, filename)
    if archive_path is None:
        return jsonify({"ok": False, "error": "invalid filename"}), 400

    if not archive_path.exists():
        return jsonify({"ok": False, "error": "archive not found"}), 404

    if archive_path.suffix.lower() != ".zip":
        return jsonify({"ok": False, "error": "only .zip archives are supported"}), 400

    result = run_command(["unzip", "-o", str(archive_path), "-d", str(installer_root)], cwd=str(installer_root))
    if result["code"] != 0:
        return jsonify({"ok": False, "error": "unzip failed", "result": result}), 500

    return jsonify({
        "ok": True,
        "archive": str(archive_path),
        "destination": str(installer_root),
        "result": result,
    })


@app.post("/host/installer/list")
def list_installer_files():
    payload = request.get_json(force=True)
    installer_root = Path(payload.get("shared_installer_path", os.getenv("SHARED_INSTALLER_PATH", "/opt/fs25/installer")))
    installer_root.mkdir(parents=True, exist_ok=True)
    apply_permissions(installer_root, recursive=True)

    files = []
    for entry in sorted(installer_root.iterdir(), key=lambda item: (not item.is_file(), item.name.lower())):
        stat = entry.stat()
        files.append({
            "name": entry.name,
            "is_file": entry.is_file(),
            "is_dir": entry.is_dir(),
            "size": stat.st_size,
            "modified_at": int(stat.st_mtime),
            "is_zip": entry.is_file() and entry.suffix.lower() == ".zip",
        })

    return jsonify({
        "ok": True,
        "path": str(installer_root),
        "files": files,
    })


@app.post("/fs/check")
def check_fs_access():
    payload = request.get_json(force=True)
    root = Path(str(payload.get("path", "")).strip())

    if str(root).strip() == "":
        return jsonify({"ok": False, "error": "path is required"}), 400

    status = check_directory_access(root)
    return jsonify({"ok": True, "path": str(root), "status": status})


@app.post("/fs/list")
def list_fs_path():
    payload = request.get_json(force=True)
    root = Path(str(payload.get("path", "")).strip())
    subpath = str(payload.get("subpath", "")).strip()

    if str(root).strip() == "":
        return jsonify({"ok": False, "error": "path is required"}), 400

    root.mkdir(parents=True, exist_ok=True)
    directory = resolve_subpath(root, subpath)
    if directory is None:
        return jsonify({"ok": False, "error": "invalid subpath"}), 400

    directory.mkdir(parents=True, exist_ok=True)
    access = check_directory_access(directory)

    files = []
    for entry in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
        stat = entry.stat()
        relative_path = str(entry.relative_to(root.resolve())).replace("\\", "/")
        files.append({
            "name": entry.name,
            "relative_path": relative_path,
            "is_file": entry.is_file(),
            "is_dir": entry.is_dir(),
            "size": stat.st_size,
            "modified_at": int(stat.st_mtime),
        })

    return jsonify({
        "ok": True,
        "root_path": str(root.resolve()),
        "path": str(directory),
        "subpath": "" if directory == root.resolve() else str(directory.relative_to(root.resolve())).replace("\\", "/"),
        "access": access,
        "files": files,
    })


@app.post("/host/upload/stream")
def upload_host_file_stream():
    token = request.headers.get("X-Upload-Token", "").strip()
    filename = request.headers.get("X-Upload-Filename", "").strip()
    scope = "panel-upload"

    if not safe_upload_name(filename):
        response = jsonify({"ok": False, "error": "invalid filename"})
        return add_cors_headers(response), 400

    is_valid, token_data = verify_upload_token(token, filename, scope)
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
        apply_permissions(destination_root, recursive=True)
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
    scope = "panel-upload"

    try:
        offset = int(request.headers.get("X-Upload-Offset", "0").strip())
        total_size = int(request.headers.get("X-Upload-Total-Size", "0").strip())
        is_last_chunk = request.headers.get("X-Upload-Is-Last", "0").strip() == "1"
    except ValueError:
        return jsonify({"ok": False, "error": "invalid chunk metadata"}), 400

    if not safe_upload_name(filename):
        return jsonify({"ok": False, "error": "invalid filename"}), 400

    is_valid, token_data = verify_upload_token(token, filename, scope)
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
        apply_permissions(destination_root, recursive=True)

    return jsonify({
        "ok": True,
        "received_offset": offset,
        "written_size": written_size,
        "completed": is_last_chunk,
        "path": str(destination if is_last_chunk else temp_destination),
    })


if __name__ == "__main__":
    restore_desired_instances()
    app.run(host="0.0.0.0", port=8081)
