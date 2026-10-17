"""Summarise how a game server container is wired for main-site game panels and VNC.

The main site opens game admin panels and the VNC console through the node's nginx, which
reaches each game container by name on the management network. Only the desktop console ports
(VNC and noVNC) must be published on loopback; the game admin panel, game port and SFTP port are
public by design. This module reduces `docker inspect` output to the facts the readiness check
needs.
"""
import hashlib
import json
import re
from pathlib import Path
from typing import Callable, Optional

MANAGEMENT_NETWORK = "fsg-management"
CONSOLE_PORTS = {"5900", "6080"}
LOOPBACK_ADDRESSES = {"127.0.0.1", "::1"}


def port_bindings(bindings: dict) -> dict[str, list[dict[str, str]]]:
    """Every published container port (e.g. "22/tcp") mapped to the host address(es) it is
    bound to. Used to confirm a container actually publishes the port its .env says it should,
    not just that some port is open."""
    result: dict[str, list[dict[str, str]]] = {}
    for port, targets in (bindings or {}).items():
        result[str(port)] = [
            {
                "host_ip": str((target or {}).get("HostIp") or "0.0.0.0"),
                "host_port": str((target or {}).get("HostPort") or ""),
            }
            for target in (targets or [])
        ]
    return result


def source_tree_hash(root: Path) -> str:
    """Fingerprint of the game runtime's build inputs (Dockerfile, scripts, templates). Line endings are normalised so a
    Windows checkout and a Linux one give the same answer, and Python caches are ignored."""
    digest = hashlib.sha256()
    for path in sorted(Path(root).rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
        digest.update(b"\0")
    return digest.hexdigest()


def image_is_stale(label: Optional[str], current: str) -> bool:
    """An image only counts as stale when it carries a fingerprint that no longer matches the source. A missing image
    (None) is built elsewhere, and an image built before fingerprints existed ("") is left alone so that updating the
    node software never rebuilds a working runtime by surprise."""
    return bool(label) and label != current


def set_env_value(text: str, key: str, value: str) -> str:
    """Return .env text with `key` set to `value`: replaces every existing assignment, or appends one."""
    lines = text.splitlines()
    pattern = re.compile(r"^\s*" + re.escape(key) + r"\s*=")
    found = False
    for index, line in enumerate(lines):
        if pattern.match(line):
            lines[index] = f"{key}={value}"
            found = True
    if not found:
        lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def compose_target(labels: dict, allowed_root: str = "/opt") -> Optional[dict]:
    """Where a running container's Compose project lives, from the labels Docker put on it.
    Refuses anything outside `allowed_root` so a label can never point the agent at another path."""
    labels = labels or {}
    project = str(labels.get("com.docker.compose.project") or "")
    workdir = str(labels.get("com.docker.compose.project.working_dir") or "")
    config = str(labels.get("com.docker.compose.project.config_files") or "").split(",")[0].strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", project):
        return None
    if not workdir.startswith(allowed_root + "/") or ".." in workdir.split("/"):
        return None
    if config and (not config.startswith(workdir + "/") or ".." in config.split("/")):
        return None
    return {"project": project, "workdir": workdir, "config": config or workdir + "/docker-compose.yml"}


def admin_sftp_report(summary: dict, banner: str, firewall_allowed: Optional[set]) -> dict:
    """Plain-language state of the node's admin SFTP container for the main site. `banner` is what
    sshd printed when probed from inside the container; `firewall_allowed` is the set of
    (port, proto) UFW allows, or None when UFW is not managed here."""
    published = [b for b in (summary.get("ports") or {}).get("22/tcp", []) if b.get("host_port")]
    loopback_only = bool(published) and all(b.get("host_ip") in LOOPBACK_ADDRESSES for b in published)
    port = int(published[0]["host_port"]) if published and str(published[0]["host_port"]).isdigit() else None
    answering = str(banner or "").startswith("SSH-")
    if not summary.get("exists"):
        state = "missing"
    elif not summary.get("running"):
        state = "stopped"
    elif not answering:
        state = "not-answering"
    else:
        state = "ready"
    return {
        "ok": True,
        "state": state,
        "container": summary.get("name"),
        "exists": bool(summary.get("exists")),
        "running": bool(summary.get("running")),
        "status": summary.get("status"),
        "answering": answering,
        "banner": str(banner or "")[:80],
        "port": port,
        "bindings": published,
        "loopback_only": loopback_only,
        "access_mode": "tunnel" if loopback_only else "public",
        "firewall_managed": firewall_allowed is not None,
        "firewall_open": None if firewall_allowed is None or port is None else (port, "tcp") in firewall_allowed,
    }


def summarize(inspect: Optional[dict], name: str) -> dict:
    if not isinstance(inspect, dict) or not inspect:
        return {
            "exists": False,
            "name": name,
            "running": False,
            "status": "missing",
            "networks": [],
            "management_network": False,
            "admin_ports_loopback": True,
            "exposed_admin_ports": [],
            "ports": {},
        }
    state = inspect.get("State") or {}
    networks = sorted(((inspect.get("NetworkSettings") or {}).get("Networks") or {}).keys())
    bindings = (inspect.get("HostConfig") or {}).get("PortBindings") or {}
    exposed = []
    for port, targets in bindings.items():
        if str(port).split("/")[0] not in CONSOLE_PORTS:
            continue
        for target in targets or []:
            host_ip = str((target or {}).get("HostIp") or "")
            if host_ip not in LOOPBACK_ADDRESSES:
                exposed.append(f"{host_ip or '0.0.0.0'}:{(target or {}).get('HostPort', '')}->{port}")
    return {
        "exists": True,
        "name": name,
        "running": bool(state.get("Running")),
        "status": str(state.get("Status") or "unknown"),
        "networks": networks,
        "management_network": MANAGEMENT_NETWORK in networks,
        "admin_ports_loopback": not exposed,
        "exposed_admin_ports": exposed,
        "ports": port_bindings(bindings),
    }


def inspect_setup(run_command: Callable[..., dict], name: str) -> dict:
    result = run_command(["docker", "inspect", name, "--format", "{{json .}}"], timeout=10)
    output = (result.get("stdout") or "").strip()
    if result.get("code") != 0 or not output:
        return summarize(None, name)
    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        return summarize(None, name)
    return summarize(data if isinstance(data, dict) else None, name)
