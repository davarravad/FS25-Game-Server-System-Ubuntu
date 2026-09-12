"""Summarise how a game server container is wired for main-site game panels and VNC.

The main site opens game admin panels and the VNC console through the node's nginx, which
reaches each game container by name on the management network and expects the administrative
ports to be published on loopback only. This module reduces `docker inspect` output to the
facts the readiness check needs.
"""
import json
from typing import Callable, Optional

MANAGEMENT_NETWORK = "fsg-management"
GAME_PORT = "10823"
LOOPBACK_ADDRESSES = {"127.0.0.1", "::1"}


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
        }
    state = inspect.get("State") or {}
    networks = sorted(((inspect.get("NetworkSettings") or {}).get("Networks") or {}).keys())
    bindings = (inspect.get("HostConfig") or {}).get("PortBindings") or {}
    exposed = []
    for port, targets in bindings.items():
        if str(port).split("/")[0] == GAME_PORT:
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
