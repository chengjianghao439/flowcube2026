#!/usr/bin/env bash
set -euo pipefail

# 用法：publish-pda.sh <apk-path> <version-json-path> <publish-dir>
# 调用方持有部署锁；目录锁额外防止独立调用并发发布。只切换部署清单，不写 Git version.json。
if [[ $# -ne 3 ]]; then
  echo '用法：publish-pda.sh <apk-path> <version-json-path> <publish-dir>' >&2
  exit 2
fi

python3 - "$@" <<'PY'
import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import tempfile


def fail(message):
    raise ValueError(message)


def open_regular(filename):
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        fail('输入必须是普通文件')
    return os.fdopen(fd, 'rb')


def validate_meta(meta):
    if not isinstance(meta, dict):
        fail('版本清单必须是 JSON 对象')
    code = meta.get('versionCode')
    if type(code) is not int or not 0 < code <= 2147483647:
        fail('versionCode 必须是正整数且在 Android 允许范围内')
    if not isinstance(meta.get('version'), str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?', meta['version']):
        fail('version 必须是有效的版本号')
    filename = meta.get('filename', 'app-release.apk')
    if not isinstance(filename, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.apk', filename):
        fail('APK 文件名非法，不能含目录或特殊字符')
    return meta


def file_digest(filename):
    with open_regular(filename) as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
        return digest.hexdigest(), source.tell()


def publish(apk_input, json_input, output_dir):
    if os.path.islink(output_dir):
        fail('发布目录不能是符号链接')
    os.makedirs(output_dir, exist_ok=True)
    output_dir = os.path.abspath(output_dir)
    lock_fd = os.open(os.path.join(output_dir, '.publish-pda.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail('另一个 PDA 发布正在进行，请稍后重试')
        with open_regular(json_input) as source:
            meta = validate_meta(json.load(source))
        temporary = []
        try:
            # 只散列复制后的临时包，避免输入文件变化造成清单与实际安装内容不一致。
            fd, apk_temp = tempfile.mkstemp(prefix='.publish-pda-', suffix='.apk', dir=output_dir)
            temporary.append(apk_temp)
            digest = hashlib.sha256()
            size = 0
            with os.fdopen(fd, 'wb') as target, open_regular(apk_input) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    target.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                target.flush()
                os.fchmod(target.fileno(), 0o644)
                os.fsync(target.fileno())
            sha256 = digest.hexdigest()
            if not size:
                fail('不能发布空 APK')
            if meta.get('sha256') is not None and meta['sha256'] != sha256:
                fail('APK sha256 与输入清单不一致')
            if meta.get('size') is not None and (type(meta['size']) is not int or meta['size'] != size):
                fail('APK 大小与输入清单不一致')
            filename = f"FlowCubePDA-{meta['versionCode']}-{sha256}.apk"
            manifest_path = os.path.join(output_dir, 'published-version.json')
            old_path = manifest_path if os.path.lexists(manifest_path) else os.path.join(output_dir, 'version.json')
            if os.path.lexists(old_path):
                with open_regular(old_path) as source:
                    old = validate_meta(json.load(source))
                old_apk = os.path.join(output_dir, old.get('filename', 'app-release.apk'))
                # Git 清单本身不是部署事实；仅已存在的旧包或部署清单可以阻止版本回退。
                if old_path == manifest_path or os.path.lexists(old_apk):
                    old_hash, old_size = file_digest(old_apk)
                    if old.get('sha256') is not None and old['sha256'] != old_hash:
                        fail('已部署 APK 摘要异常，不能继续发布')
                    if old.get('size') is not None and old['size'] != old_size:
                        fail('已部署 APK 大小异常，不能继续发布')
                    if meta['versionCode'] < old['versionCode']:
                        fail('不能回退 versionCode')
                    if meta['versionCode'] == old['versionCode']:
                        if sha256 != old_hash or meta['version'] != old['version']:
                            fail('同一 versionCode 不能对应不同版本或安装包')
                        if old_path == manifest_path and old.get('filename') == filename and old.get('sha256') == sha256:
                            print(f"PDA {meta['version']} ({meta['versionCode']}) 已发布，无需改写")
                            return
                        # 首次迁移旧固定包时保留原发布时间，建立不可变文件和部署清单。
                        meta = {**meta, 'publishedAt': old.get('publishedAt') or meta.get('publishedAt')}
            for existing in os.listdir(output_dir):
                if existing.startswith(f"FlowCubePDA-{meta['versionCode']}-") and existing.endswith('.apk') and existing != filename:
                    fail('发布目录已有同 versionCode 的不同安装包')
            destination = os.path.join(output_dir, filename)
            if os.path.lexists(destination):
                if file_digest(destination) != (sha256, size):
                    fail('已存在的不可变 APK 内容不匹配')
            else:
                # link 为独占创建，不覆盖已有文件；包和清单均在同一文件系统内落盘。
                os.link(apk_temp, destination)
            meta = {**meta, 'filename': filename, 'sha256': sha256, 'size': size,
                    'publishedAt': meta.get('publishedAt') or datetime.datetime.now(datetime.timezone.utc).isoformat()}
            fd, meta_temp = tempfile.mkstemp(prefix='.publish-pda-', suffix='.json', dir=output_dir)
            temporary.append(meta_temp)
            with os.fdopen(fd, 'w', encoding='utf-8') as target:
                json.dump(meta, target, ensure_ascii=False, indent=2)
                target.write('\n')
                target.flush()
                os.fchmod(target.fileno(), 0o644)
                os.fsync(target.fileno())
            directory_fd = os.open(output_dir, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
                os.replace(meta_temp, manifest_path)
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
            print(f"PDA {meta['version']} ({meta['versionCode']}) 发布完成：{filename}")
        finally:
            for filename in temporary:
                if os.path.lexists(filename):
                    os.unlink(filename)


try:
    publish(*sys.argv[1:])
except (OSError, ValueError, TypeError) as error:
    print(f'PDA 发布失败：{error}', file=sys.stderr)
    sys.exit(1)
PY
