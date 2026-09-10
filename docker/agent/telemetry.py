"""Bounded, persistent telemetry. Collection never runs in an HTTP request."""
import json
import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


class Telemetry:
    def __init__(self, base, command, collect_instance):
        self.base = Path(base)
        self.path = self.base / '.telemetry.sqlite3'
        self.command = command
        self.collect_instance = collect_instance
        self.previous_cpu = None
        self.previous_net = None
        self.instance_network = {}

    @contextmanager
    def connect(self):
        self.base.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=5)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('CREATE TABLE IF NOT EXISTS samples (scope TEXT, ts INTEGER, data TEXT, PRIMARY KEY(scope, ts))')
        conn.execute('CREATE INDEX IF NOT EXISTS samples_retention ON samples(ts)')
        conn.execute('CREATE TABLE IF NOT EXISTS latest (scope TEXT PRIMARY KEY, ts INTEGER, data TEXT)')
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def latest(self, scope):
        with self.connect() as conn:
            row = conn.execute('SELECT ts, data FROM latest WHERE scope=?', (scope,)).fetchone()
        return {'sampled_at': row[0] if row else None, 'latest': json.loads(row[1]) if row else None}

    def host(self):
        proc = Path(os.getenv('HOST_PROC_PATH', '/host/proc'))
        cpu = [int(v) for v in (proc / 'stat').read_text().splitlines()[0].split()[1:9]]
        total, idle = sum(cpu), cpu[3] + cpu[4]
        percent = None
        if self.previous_cpu and total > self.previous_cpu[0]:
            percent = 100 * (1 - (idle - self.previous_cpu[1]) / (total - self.previous_cpu[0]))
        self.previous_cpu = total, idle
        mem = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in (proc / 'meminfo').read_text().splitlines()}
        fs = os.statvfs(self.base)
        result = dict(cpu_percent=percent, memory_used_bytes=mem['MemTotal'] - mem['MemAvailable'],
                      memory_limit_bytes=mem['MemTotal'], disk_used_bytes=(fs.f_blocks-fs.f_bfree)*fs.f_frsize,
                      disk_limit_bytes=fs.f_blocks*fs.f_frsize,
                      uptime_seconds=float((proc / 'uptime').read_text().split()[0]))
        # PID 1 is the host init process in the bind-mounted host proc filesystem.
        rx = tx = 0
        try:
            network_lines = (proc / '1/net/dev').read_text().splitlines()[2:]
        except OSError:
            result.update(network_in_bytes_sec=None, network_out_bytes_sec=None)
            return result
        for line in network_lines:
            name, values = line.split(':', 1)
            if name.strip() == 'lo' or name.strip().startswith(('veth', 'docker', 'br-')):
                continue
            values = values.split()
            rx += int(values[0])
            tx += int(values[8])
        now = time.monotonic()
        result.update(network_in_bytes_sec=None, network_out_bytes_sec=None)
        if self.previous_net:
            before, old_rx, old_tx = self.previous_net
            if now > before and rx >= old_rx and tx >= old_tx:
                result.update(network_in_bytes_sec=(rx-old_rx)/(now-before), network_out_bytes_sec=(tx-old_tx)/(now-before))
        self.previous_net = now, rx, tx
        return result

    def save(self, scope, data):
        timestamp = int(time.time())
        numeric = {key: value for key, value in data.items() if value is None or (isinstance(value, (float, int)) and not isinstance(value, bool))}
        with self.connect() as conn:
            conn.execute('INSERT OR REPLACE INTO samples VALUES (?, ?, ?)', (scope, timestamp, json.dumps(numeric)))
            conn.execute('INSERT OR REPLACE INTO latest VALUES (?, ?, ?)', (scope, timestamp, json.dumps(data)))

    def sample_instance(self, instance, raw):
        try:
            result = self.collect_instance(instance, {'code': 0, 'stdout': raw})
            if result['ok']:
                metrics = result['metrics']
                now = time.monotonic()
                rx, tx = metrics.get('network_in_bytes'), metrics.get('network_out_bytes')
                previous = self.instance_network.get(instance)
                metrics.update(network_in_bytes_sec=None, network_out_bytes_sec=None)
                if rx is not None and tx is not None:
                    if previous and now > previous[0] and rx >= previous[1] and tx >= previous[2]:
                        elapsed = now - previous[0]
                        metrics.update(network_in_bytes_sec=(rx-previous[1])/elapsed, network_out_bytes_sec=(tx-previous[2])/elapsed)
                    self.instance_network[instance] = (now, rx, tx)
                else:
                    self.instance_network.pop(instance, None)
                self.save(instance, metrics)
        except Exception:
            logging.exception('Instance telemetry failed: %s', instance)

    def read(self, scope, hours):
        now = int(time.time())
        # At most 360 chart points regardless of the selected range.
        bucket = max(30, hours * 3600 // 360)
        keys = ('cpu_percent', 'memory_used_bytes', 'disk_used_bytes', 'network_in_bytes_sec', 'network_out_bytes_sec')
        averages = ', '.join(f"AVG(json_extract(data, '$.{key}'))" for key in keys)
        with self.connect() as conn:
            rows = conn.execute(f'SELECT MIN(ts), {averages} FROM samples WHERE scope=? AND ts>=? GROUP BY CAST(ts / ? AS INTEGER) ORDER BY MIN(ts)', (scope, now-hours*3600, bucket)).fetchall()
            latest = conn.execute('SELECT ts, data FROM latest WHERE scope=?', (scope,)).fetchone()
        points = [dict(timestamp=row[0], **dict(zip(keys, row[1:]))) for row in rows]
        return dict(ok=True, points=points, latest=json.loads(latest[1]) if latest else None,
                    sampled_at=latest[0] if latest else None, interval_seconds=30, bucket_seconds=bucket)

    def run(self):
        while True:
            started = time.monotonic()
            try:
                self.save('host', self.host())
            except Exception:
                logging.exception('Host telemetry collection failed')
            try:
                instances = [p.parent.name for p in self.base.glob('*/compose.yml')]
                stats = self.command(['docker', 'stats', '--no-stream', '--format', '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}'], timeout=15)
                if stats['code'] == 0:
                    by_name = dict(line.split('|', 1) for line in stats['stdout'].splitlines() if '|' in line)
                    with ThreadPoolExecutor(max_workers=4) as executor:
                        list(executor.map(lambda instance: self.sample_instance(instance, by_name.get(instance, '')), instances))
                with self.connect() as conn:
                    conn.execute('DELETE FROM samples WHERE ts < ?', (int(time.time())-30*86400,))
                    conn.execute('DELETE FROM latest WHERE ts < ?', (int(time.time())-30*86400,))
            except Exception:
                logging.exception('Telemetry collection failed')
            time.sleep(max(1, 30-(time.monotonic()-started)))

    def start(self):
        threading.Thread(target=self.run, name='telemetry', daemon=True).start()
