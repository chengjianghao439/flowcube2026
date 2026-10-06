#!/usr/bin/env python3
"""接收短期 HTTPS 地址；仅释放预期归档，不执行 ZIP 内的文件。"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
import zipfile

MAX_METADATA = 1024 * 1024


def accept_relay_archive(destination, expected_sha, expected_bytes):
    """受信操作端可中转同一 CI 归档；仍以 runner 计算的字节数和摘要验收。"""
    relay = Path(str(destination) + '.relay')
    if not relay.exists():
        return False
    if relay.is_symlink() or not relay.is_file() or relay.stat().st_size != expected_bytes:
        raise ValueError('invalid relay archive')
    digest = hashlib.sha256()
    with relay.open('rb') as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha:
        raise ValueError('relay SHA256 mismatch')
    os.replace(relay, destination)
    print('==> 中转归档字节数与 SHA256 校验通过')
    return True


def wait_for_relay(destination, expected_sha, expected_bytes, timeout=900):
    # marker 只申请有界等待，绝不替代归档摘要校验；路径绑定本轮 run/attempt。
    if not Path(str(destination) + '.relay.pending').is_file():
        return False
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if accept_relay_archive(destination, expected_sha, expected_bytes):
            return True
        time.sleep(1)
    raise RuntimeError('relay timed out')


def unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate manifest key')
        result[key] = value
    return result


def artifact_member(source, entry, expected_source_sha=None, expected_run_id=None):
    # This script is copied alone to the server. Keep validation in sync with
    # local-release-relay.py; metadata is checked in memory, never released.
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', entry):
        raise ValueError('Invalid artifact entry')
    members = source.infolist()
    is_release = entry.endswith(('.exe', '.apk'))
    allowed = {entry}
    if is_release:
        allowed.update(['release-provenance.json', 'version.json' if entry.endswith('.apk') else 'releaseNotes.md'])
    names = [member.filename for member in members]
    if not members or len(members) > len(allowed) or len(names) != len(set(names)):
        raise ValueError('Unexpected ZIP members')
    for member in members:
        file_type = stat.S_IFMT(member.external_attr >> 16)
        if (member.filename not in allowed or member.orig_filename != member.filename or member.is_dir()
                or file_type not in (0, stat.S_IFREG) or member.flag_bits & 1):
            raise ValueError('Unexpected ZIP member')
    if entry not in names:
        raise ValueError('Missing artifact binary')
    binary = members[names.index(entry)]
    if len(members) == 1:
        # Older artifacts still require the runner's expected raw-byte hash.
        return binary, None
    if not is_release or 'release-provenance.json' not in names or (entry.endswith('.apk') and 'version.json' not in names):
        raise ValueError('Missing release metadata')
    metadata = {}
    total = 0
    for member in members:
        if member is binary:
            continue
        total += member.file_size
        if not 0 <= member.file_size <= MAX_METADATA or total > MAX_METADATA:
            raise ValueError('Release metadata too large')
        with source.open(member) as content:
            raw = content.read(MAX_METADATA + 1)
        if len(raw) != member.file_size:
            raise ValueError('Release metadata size mismatch')
        metadata[member.filename] = raw
    manifest = json.loads(metadata.pop('release-provenance.json').decode('utf-8'), object_pairs_hook=unique_json_object)
    if (not isinstance(manifest, dict) or set(manifest) != {'sha', 'runId', 'file', 'sha256', 'metadata'}
            or not isinstance(manifest['sha'], str) or not re.fullmatch(r'[a-f0-9]{40}', manifest['sha'])
            or not isinstance(manifest['runId'], str) or not re.fullmatch(r'[1-9][0-9]{0,19}', manifest['runId'])
            or manifest['file'] != entry or not isinstance(manifest['sha256'], str)
            or not re.fullmatch(r'[a-f0-9]{64}', manifest['sha256'])
            or not isinstance(manifest['metadata'], dict) or set(manifest['metadata']) != set(metadata)):
        raise ValueError('Invalid release manifest')
    if ((expected_source_sha is not None and manifest['sha'] != expected_source_sha)
            or (expected_run_id is not None and manifest['runId'] != str(expected_run_id))):
        raise ValueError('Release source/run mismatch')
    for name, raw in metadata.items():
        expected = manifest['metadata'][name]
        if not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected) or hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError('Release metadata SHA256 mismatch')
    return binary, manifest


def unpack_archive(zip_path, destination, expected_sha, expected_bytes, expected_entry='flowcube-images.tar.gz',
                   expected_source_sha=None, expected_run_id=None):
    destination = Path(destination)
    partial = destination.with_suffix(destination.suffix + '.partial')
    try:
        with zipfile.ZipFile(zip_path) as archive:
            entry, manifest = artifact_member(archive, expected_entry, expected_source_sha, expected_run_id)
            if entry.file_size != expected_bytes or not 0 < expected_bytes <= 2 * 1024**3:
                raise ValueError('artifact size mismatch')
            # The fresh CI download verifies SHA/run before supplying this hash;
            # CLI callers bind the received payload to those exact verified bytes.
            if manifest and manifest['sha256'] != expected_sha:
                raise ValueError('release manifest SHA256 mismatch')
            digest = hashlib.sha256()
            count = 0
            with archive.open(entry) as src, partial.open('wb') as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > expected_bytes:
                        raise ValueError('artifact too large')
                    digest.update(chunk)
                    dst.write(chunk)
            if count != expected_bytes or digest.hexdigest() != expected_sha:
                raise ValueError('artifact SHA256 mismatch')
        os.replace(partial, destination)
    finally:
        # 生产仍使用 Python 3.6；Path.unlink(missing_ok=...) 从 3.8 才支持。
        try:
            partial.unlink()
        except FileNotFoundError:
            pass


def main():
    destination, expected_sha, size_text = sys.argv[1:4]
    expected_entry = sys.argv[4] if len(sys.argv) == 5 else 'flowcube-images.tar.gz'
    if len(sys.argv) not in (4, 5) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', expected_entry):
        raise ValueError('invalid artifact entry')
    size = int(size_text)
    if not Path(destination).is_absolute() or not re.fullmatch('[a-f0-9]{64}', expected_sha) or not 0 < size <= 2 * 1024**3:
        raise ValueError('invalid artifact arguments')
    signed_url = sys.stdin.readline(16384).strip()
    parsed = urlsplit(signed_url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or re.search(r'[\s"\\]', signed_url):
        raise ValueError('invalid signed URL')
    if accept_relay_archive(destination, expected_sha, size) or wait_for_relay(destination, expected_sha, size):
        return
    # 不将签名地址放进 ps 可见的命令参数、磁盘文件或 curl 错误日志。
    with tempfile.TemporaryDirectory(prefix=Path(destination).name + '.https-', dir=str(Path(destination).parent)) as temp:
        archive = Path(temp) / 'artifact.zip'
        started = time.monotonic()
        result = subprocess.run([
            'curl', '--config', '-', '--silent', '--fail', '--location',
            '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15',
            '--max-time', '150', '--max-filesize', str(size + MAX_METADATA + 64 * 1024), '--output', str(archive),
        ], input='url = "' + signed_url + '"\n', universal_newlines=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=160)
        if result.returncode:
            # curl 的退出码与耗时可用于区分超时、HTTP 拒绝和连接失败；
            # 不打印异常对象、签名 URL 或 curl stderr。
            print('HTTPS artifact receive failed: curl_exit={} elapsed={:.1f}s'.format(
                result.returncode, time.monotonic() - started), file=sys.stderr)
            if accept_relay_archive(destination, expected_sha, size) or wait_for_relay(destination, expected_sha, size):
                return
            raise RuntimeError('HTTPS transfer failed')
        unpack_archive(archive, destination, expected_sha, size, expected_entry)
    print('==> HTTPS 镜像下载与 SHA256 校验通过')


if __name__ == '__main__':
    def interrupted(_signum, _frame):
        raise InterruptedError('transfer interrupted')
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        main()
    except Exception:
        print('HTTPS 镜像拉取或完整性校验失败；允许回退 SCP', file=sys.stderr)
        sys.exit(1)
