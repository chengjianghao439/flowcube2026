#!/usr/bin/env python3
"""接收短期 HTTPS 地址；仅释放预期归档，不执行 ZIP 内的文件。"""
import hashlib
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
import zipfile


def unpack_archive(zip_path, destination, expected_sha, expected_bytes):
    destination = Path(destination)
    partial = destination.with_suffix(destination.suffix + '.partial')
    try:
        with zipfile.ZipFile(zip_path) as archive:
            entries = archive.infolist()
            if len(entries) != 1 or entries[0].filename != 'flowcube-images.tar.gz':
                raise ValueError('unexpected artifact entry')
            if entries[0].file_size != expected_bytes:
                raise ValueError('artifact size mismatch')
            digest = hashlib.sha256()
            count = 0
            with archive.open(entries[0]) as src, partial.open('wb') as dst:
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
    destination, expected_sha, size_text = sys.argv[1:]
    size = int(size_text)
    if not Path(destination).is_absolute() or not re.fullmatch('[a-f0-9]{64}', expected_sha) or not 0 < size <= 2 * 1024**3:
        raise ValueError('invalid artifact arguments')
    signed_url = sys.stdin.readline(16384).strip()
    parsed = urlsplit(signed_url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or re.search(r'[\s"\\]', signed_url):
        raise ValueError('invalid signed URL')
    # 不将签名地址放进 ps 可见的命令参数、磁盘文件或 curl 错误日志。
    with tempfile.TemporaryDirectory(prefix=Path(destination).name + '.https-', dir=str(Path(destination).parent)) as temp:
        archive = Path(temp) / 'artifact.zip'
        result = subprocess.run([
            'curl', '--config', '-', '--silent', '--fail', '--location',
            '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15',
            '--max-time', '150', '--max-filesize', str(size + 1024 * 1024), '--output', str(archive),
        ], input='url = "' + signed_url + '"\n', universal_newlines=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=160)
        if result.returncode:
            raise RuntimeError('HTTPS transfer failed')
        unpack_archive(archive, destination, expected_sha, size)
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
