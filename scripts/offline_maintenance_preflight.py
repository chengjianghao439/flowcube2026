#!/usr/bin/env python3
"""Read-only OFFLINE maintenance preflight, repaired from the task-3 temporary script.

Usage: python3 -B scripts/offline_maintenance_preflight.py --evidence evidence.json
Only subprocess: local `docker compose ... config --format json` (no daemon/SSH/SQL).
Never edits evidence, Compose files, locks, deployment state, or the database.
Keep the seven retained server temporary files and the old deployment lock intact.
If an operator calls stop, send no more commands (including follow-up reads); hand
off the last executed command, UTC timestamp and in-flight/unknown outcome. Do not
kill an unsafe-to-interrupt database process or issue an unapproved rollback.
Future server writes need a path/content/purpose/persistence/cleanup-owner inventory,
explicit user approval, and execution by operations; this tool authorizes none.
A successful result verifies supplied snapshots, NOT their freshness or a live server.

Evidence schema (private local JSON, never commit real evidence):
  guards: fields consumed by check_guards below; collected by authorized operations.
  services: exactly mysql/backend/frontend, each containing:
    inspect: saved docker inspect object (including Compose labels)
    imageInspect: saved image inspect object for CURRENT Config.Image
    inputs: {projectDirectory: local snapshot directory, projectName: original project label,
             workingDirectory: original Compose working_dir label,
             files: [{label: exact original absolute path, path: local snapshot path}, ...],
             interpolation: {explicit frozen Compose interpolation variables}}
    candidateInputs: same shape, for a separately prepared prospective snapshot;
                     ordered original file labels MUST remain identical.
  targetMysqlImageInspect: saved image inspect of the locally loaded mysql:8.0.46
                           (verified by image ID; RepoDigests not required).

Explicit ordered file declarations are mandatory and verified against inspect labels.
No default prod file; the supplemental file need not define frontend. Compose itself
resolves YAML, inheritance, env_file, interpolation, merge precedence and defaults.
Use a complete local copy of required referenced files; --env-file /dev/null disables
implicit .env, and ambient shell/DOCKER_HOST/COMPOSE_FILE variables are not inherited.
Candidate input files must already exist: this tool does NOT create/replace the pin.
Separate current/candidate snapshot directories are supported. Only normalized
bind sources and build context/dockerfile paths beneath each declared snapshot root
are projected to its original workingDirectory. Environment/command strings and
external absolute paths are never rewritten or ignored.

Only MySQL image may change: local 8.0.45 reference -> local mysql:8.0.46 tag with
pull_policy: never (no registry pull), verified by runtime image ID.
All other normalized fields/documents must match exactly. Unsupported Compose runtime
features fail closed rather than being silently ignored. build/depends_on are Compose
orchestration fields, checked for candidate drift; they have no container-inspect field.
Boolean normalization applies only to MySQL switch globals: int 0/1 (not bool/float),
or ASCII case-insensitive exact strings OFF/ON/0/1. Whitespace, null and others fail.
CORS environment strings compare literally, including true -> false; no truthiness.
All diagnostic text is allowlisted; untrusted keys/strings/stderr/exception text are
redacted. Equal-looking redactions still carry an explicit 'different' difference.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import sys

APP_SHA = '734ed9924a3b6d3051962a3f06f81f5a04fc4213'
# From the retained official verification. Registry index, platform manifest and
# image config/runtime ID are different layers and are never compared to each other.
MYSQL_INDEX_DIGEST = 'sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b'
MYSQL_MANIFEST_DIGEST = 'sha256:62fb722c78b24245ddff1796a0fcee4a49cc5b87e0aaaf20c92d1da9e0a2497b'
MYSQL_IMAGE_ID = 'sha256:6cd09145362dfe6831b14545de3d5fd6cc75c37cfd6ef8561429c1fc73518b39'
# The production host loaded mysql:8.0.46 from a file and cannot reliably reach
# the official registry. The pin therefore uses the LOCAL tag with pull_policy
# never (no network pull) and identity is proven by the runtime image ID alone.
# Registry references (name@digest) are rejected: Compose would try to pull them.
MYSQL_TARGET = 'mysql:8.0.46'
MYSQL_TARGET_TAGS = {'mysql:8.0.46', 'docker.io/library/mysql:8.0.46'}
MYSQL_TARGET_PULL_POLICY = 'never'
MYSQL_CURRENT_REFS = {'flowcube-mysql-current:8.0.45', 'mysql:8.0.45', 'docker.io/library/mysql:8.0.45'}
APPROVED_MIGRATIONS = {
    '293_pda_audit_logs_formal_schema.sql': '56a84651472c7524e8ffca08df7b474fea42227a7bf1922daafe9369569ac4d5',
    '294_credit_approval_proofs.sql': '6b386e5d1ceaae29b0626245898a3fdda37736bba774032ae492db510d05509e',
    '295_role_duties_approval.sql': 'ad9cd8059b93bd184c356a169c3e9d75abcd6b5c5ab3d4ee428bae0813f78f7f',
}
STRICT_ADDS = {('preset_finance_specialist', 'approval.task.view'),
               ('preset_finance_specialist', 'sale.credit.override.approve'),
               ('preset_finance_specialist', 'sale.credit.override.view'),
               ('preset_finance_specialist', 'sale.credit.view'),
               ('preset_warehouse_operator', 'warehouse.task.ship')}
PROTECTED_ROLE_CODES = {'sales', 'warehouse', 'purchaser', 'viewer'}

TABLES = ['approval_flow_steps', 'approval_flows', 'approval_instance_task_approvers', 'approval_instance_tasks', 'approval_instances', 'expense_claims', 'finance_period_backfills', 'inventory_check_item_containers', 'inventory_check_items', 'inventory_checks', 'inventory_containers', 'inventory_count_coverage', 'inventory_cycle_rules', 'inventory_disposal_conversions', 'inventory_disposal_items', 'inventory_disposal_orders', 'inventory_import_batches', 'inventory_logs', 'inventory_stock', 'inventory_warehouses', 'price_change_requests', 'purchase_orders', 'purchase_requisitions', 'sale_credit_overrides', 'sale_order_expected_bindings', 'sale_order_items', 'sale_orders', 'stock_reservations']

SAFE_KEYS = set(('environment services image name restart command entrypoint working_dir user '
                 'healthcheck ports volumes networks logging driver options memory cpu privileged '
                 'read_only CORS_ALLOW_NULL_ORIGIN CORS_REFLECT TRUST_PROXY NODE_ENV TZ '
                 'innodb_fast_shutdown log_bin_trust_function_creators actual expected '
                 'status returncode type count Id Config Env Cmd Entrypoint WorkingDir '
                 'User Labels HostConfig Image RestartPolicy Memory NanoCpus PidsLimit '
                 'pull_policy never source target published protocol host_ip backend frontend mysql').split())
SAFE_TEXT = {'OFF', 'ON', 'off', 'on', 'true', 'false', '0', '1', 'running', 'InnoDB',
             'linux', 'amd64', 'missing', 'present', 'valid JSON object', 'invalid JSON',
             'command failed', 'timeout', 'unavailable', 'different', 'required',
             'unless-stopped', 'always', 'no', 'json-file', 'read-only snapshot verified'}


def safe_key(key):
    return str(key) if key in SAFE_KEYS else '[field]'


def redact(value, sensitive=False):
    if sensitive:
        return '[redacted]'
    if type(value) in (bool, int, float) or value is None:
        return value
    if isinstance(value, str):
        return value if value in SAFE_TEXT else '[redacted]'
    if isinstance(value, dict):
        # A list preserves multiple redacted keys without collisions/secret key leaks.
        return [{'key': safe_key(k), 'value': redact(v, k not in SAFE_KEYS)} for k, v in value.items()]
    if isinstance(value, (list, tuple, set)):
        return [redact(v) for v in value]
    return '[redacted]'


def differences(actual, expected, path='$', sensitive=False):
    if sensitive:
        # Compare the full original values, then hide the entire untrusted subtree,
        # including numeric credentials and nested keys. Never log first and scrub.
        if differences(actual, expected):
            return [{'path': path, 'kind': 'different', 'actual': '[redacted]', 'expected': '[redacted]'}]
        return []
    if type(actual) is type(expected) and isinstance(actual, dict):
        result = []
        for key in sorted(set(actual) | set(expected), key=str):
            child = path + '.' + safe_key(key)
            if key not in actual or key not in expected:
                result.append({'path': child, 'kind': 'different',
                               'actual': redact(actual[key], key not in SAFE_KEYS) if key in actual else 'missing',
                               'expected': redact(expected[key], key not in SAFE_KEYS) if key in expected else 'missing'})
            else:
                result.extend(differences(actual[key], expected[key], child, key not in SAFE_KEYS))
        return result
    if type(actual) is type(expected) and isinstance(actual, list):
        result = []
        for i in range(max(len(actual), len(expected))):
            if i >= len(actual) or i >= len(expected):
                result.append({'path': path + '[' + str(i) + ']', 'kind': 'different',
                               'actual': redact(actual[i]) if i < len(actual) else 'missing',
                               'expected': redact(expected[i]) if i < len(expected) else 'missing'})
            else:
                result.extend(differences(actual[i], expected[i], path + '[' + str(i) + ']'))
        return result
    if type(actual) is type(expected) and actual == expected:
        return []
    return [{'path': path, 'kind': 'different', 'actual': redact(actual), 'expected': redact(expected)}]


class PreflightFailure(Exception):
    def __init__(self, check, actual, expected):
        # check is an internal identifier, never composed from untrusted input keys.
        self.record = {'status': 'failed', 'check': check, 'actual': redact(actual),
                       'expected': redact(expected), 'differences': differences(actual, expected)}
        if not self.record['differences']:
            self.record['differences'] = [{'path': '$', 'kind': 'different'}]
        super().__init__(json.dumps(self.record, ensure_ascii=False))


def require_equal(check, actual, expected):
    if differences(actual, expected):
        raise PreflightFailure(check, actual, expected)


def parse_switch(value, check):
    if type(value) is int and value in (0, 1):
        return value
    if type(value) is str and value.isascii() and value.upper() in ('OFF', 'ON', '0', '1'):
        return {'OFF': 0, 'ON': 1, '0': 0, '1': 1}[value.upper()]
    raise PreflightFailure(check, value, 'OFF/0 or ON/1 required')


def run(args, cwd=None, timeout=30, env=None):
    # Defense in depth: callers cannot turn the helper into an execution entrypoint.
    if (args[:2] != ['docker', 'compose'] or args[-3:] != ['config', '--format', 'json']):
        raise PreflightFailure('command.read_only', 'unavailable', 'compose config only')
    try:
        result = subprocess.run(args, cwd=cwd, timeout=timeout, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except subprocess.TimeoutExpired:
        raise PreflightFailure('compose.execute', 'timeout', 0) from None
    except OSError:
        raise PreflightFailure('compose.execute', 'unavailable', 0) from None
    if result.returncode:
        # No arguments, stdout, stderr or exception strings escape to diagnostics.
        raise PreflightFailure('compose.execute', {'returncode': result.returncode}, {'returncode': 0})
    return result.stdout


def compose_config(inputs):
    try:
        directory = Path(inputs['projectDirectory']).resolve(strict=True)
        files = [str(Path(f['path']).resolve(strict=True)) for f in inputs['files']]
        if not directory.is_dir() or not files:
            raise ValueError()
        frozen = inputs['interpolation']
        project_name = inputs['projectName']
        if not isinstance(project_name, str) or not re.fullmatch('[a-z0-9][a-z0-9_-]*', project_name):
            raise ValueError()
        if not isinstance(frozen, dict) or any(type(k) is not str or type(v) is not str for k, v in frozen.items()):
            raise ValueError()
        if any(k.startswith(('DOCKER_', 'COMPOSE_')) or k in ('PATH', 'HOME', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES') for k in frozen):
            raise ValueError()
    except (KeyError, TypeError, ValueError, OSError):
        raise PreflightFailure('compose.inputs', 'missing', 'required') from None
    args = ['docker', 'compose', '--project-directory', str(directory),
            '--project-name', project_name, '--env-file', os.devnull]
    for file in files:
        args.extend(['-f', file])
    # Do not inherit SSH/Docker contexts, interpolation variables or private shell env.
    # HOME is needed for installed Docker CLI plugin discovery, not Compose .env.
    environment = {'PATH': os.environ.get('PATH', os.defpath),
                   'HOME': os.environ.get('HOME', str(directory)), **frozen}
    output = run(args + ['config', '--format', 'json'], cwd=str(directory), env=environment)
    try:
        document = json.loads(output)
        if not isinstance(document, dict) or not isinstance(document.get('services'), dict):
            raise ValueError()
    except (ValueError, TypeError):
        raise PreflightFailure('compose.json', 'invalid JSON', 'valid JSON object') from None
    return document


def validate_inputs(service, inputs, runtime):
    try:
        labels = runtime['Config']['Labels']
        files = inputs['files']
        declarations = [f['label'] for f in files]
        if not files or len(set(declarations)) != len(files):
            raise ValueError()
        if any(not isinstance(p, str) or not p.startswith('/') or ',' in p for p in declarations):
            raise ValueError()
        actual = labels['com.docker.compose.project.config_files'].split(',')
        require_equal(service + '.compose.files', actual, declarations)
        require_equal(service + '.compose.working_dir', labels['com.docker.compose.project.working_dir'], inputs['workingDirectory'])
        require_equal(service + '.compose.service', labels['com.docker.compose.service'], service)
        require_equal(service + '.compose.project', labels['com.docker.compose.project'], inputs['projectName'])
    except (KeyError, TypeError, ValueError):
        raise PreflightFailure(service + '.compose.labels', 'missing', 'required') from None


def environment_map(values, check):
    if not isinstance(values, list):
        raise PreflightFailure(check, 'missing', 'required')
    result = {}
    for item in values:
        if not isinstance(item, str) or '=' not in item:
            raise PreflightFailure(check, item, 'required')
        key, value = item.split('=', 1)
        if key in result:
            raise PreflightFailure(check, 'duplicate environment key', 'unique keys')
        result[key] = value
    return result


def service_config(document, service):
    try:
        config = document['services'][service]
        if not isinstance(config, dict) or not isinstance(config['image'], str):
            raise ValueError()
        return config
    except (KeyError, TypeError, ValueError):
        raise PreflightFailure(service + '.compose.service', 'missing', 'required') from None


def project_path(value, local, original):
    """Relocate a known path field using explicit snapshot provenance, by boundary."""
    if not isinstance(value, str):
        return value
    local = local.rstrip('/')
    original = original.rstrip('/')
    if value == local:
        return original or '/'
    if value.startswith(local + '/'):
        return original + value[len(local):]
    return value


def normalize_document_paths(document, inputs):
    """Canonicalize only Compose path fields; keep every setting in comparison."""
    result = copy.deepcopy(document)
    try:
        local = str(Path(inputs['projectDirectory']).resolve(strict=True))
        original = inputs['workingDirectory']
        if not isinstance(original, str) or not original.startswith('/'):
            raise ValueError()
        for config in result['services'].values():
            build = config.get('build')
            if isinstance(build, dict):
                for key in ('context', 'dockerfile'):
                    if key in build:
                        build[key] = project_path(build[key], local, original)
            for mount in config.get('volumes') or []:
                if mount.get('type') == 'bind':
                    mount['source'] = project_path(mount['source'], local, original)
    except (KeyError, TypeError, ValueError, AttributeError, OSError):
        raise PreflightFailure('compose.path_projection.schema', 'missing', 'required') from None
    return result


def compare_candidate(service, current, candidate, current_inputs=None, candidate_inputs=None):
    if (current_inputs is None) != (candidate_inputs is None):
        raise PreflightFailure('compose.path_projection.inputs', 'missing', 'required')
    if current_inputs is not None:
        old = normalize_document_paths(current, current_inputs)
        new = normalize_document_paths(candidate, candidate_inputs)
    else:
        old, new = copy.deepcopy(current), copy.deepcopy(candidate)
    old_service, new_service = service_config(old, service), service_config(new, service)
    if service == 'mysql':
        if old_service['image'] not in MYSQL_CURRENT_REFS:
            raise PreflightFailure('mysql.current.reference', old_service['image'], sorted(MYSQL_CURRENT_REFS))
        require_equal('mysql.target.reference', new_service['image'], MYSQL_TARGET)
        require_equal('mysql.target.pull_policy', new_service.get('pull_policy', 'missing'),
                      MYSQL_TARGET_PULL_POLICY)
        new_service['image'] = old_service['image']
        if 'pull_policy' in old_service:
            new_service['pull_policy'] = old_service['pull_policy']
        else:
            new_service.pop('pull_policy')
    require_equal(service + '.candidate.non_image_configuration', new, old)


def verify_mysql_image(image):
    require_equal('mysql.target.runtime_image_id', image.get('Id'), MYSQL_IMAGE_ID)
    require_equal('mysql.target.platform', [image.get('Os'), image.get('Architecture')], ['linux', 'amd64'])
    # A file-loaded image carries no RepoDigests; the local tag must point at
    # exactly this image ID. RepoDigests are intentionally not required.
    tags = image.get('RepoTags')
    if not isinstance(tags, list) or not any(tag in MYSQL_TARGET_TAGS for tag in tags):
        raise PreflightFailure('mysql.target.local_tag', 'missing', 'present')
    env = environment_map(image.get('Config', {}).get('Env'), 'mysql.target.environment')
    require_equal('mysql.target.version', env.get('MYSQL_VERSION'), '8.0.46-1.el9')


def duration(value):
    if not isinstance(value, str):
        raise PreflightFailure('config.duration', value, 'duration string')
    units = {'ns': 1, 'us': 1000, 'ms': 1000000, 's': 1000000000, 'm': 60000000000, 'h': 3600000000000}
    tokens = list(re.finditer(r'(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)', value))
    if not tokens or ''.join(t.group() for t in tokens) != value:
        raise PreflightFailure('config.duration', value, 'duration string')
    return int(sum(float(t[1]) * units[t[2]] for t in tokens))


SUPPORTED = set(('image container_name restart environment command entrypoint working_dir user '
                 'healthcheck ports volumes networks logging mem_limit memswap_limit cpus cpu_shares '
                 'cpu_period cpu_quota cpuset pids_limit privileged read_only cap_add cap_drop '
                 'security_opt dns dns_search extra_hosts sysctls stop_signal stop_grace_period '
                 'init shm_size ulimits labels build depends_on profiles expose hostname domainname').split())
HOST_FIELDS = {
    'mem_limit': ('Memory', 0), 'memswap_limit': ('MemorySwap', 0),
    'cpu_shares': ('CpuShares', 0), 'cpu_period': ('CpuPeriod', 0), 'cpu_quota': ('CpuQuota', 0),
    'cpuset': ('CpusetCpus', ''), 'pids_limit': ('PidsLimit', None),
    'privileged': ('Privileged', False), 'read_only': ('ReadonlyRootfs', False),
    'cap_add': ('CapAdd', None), 'cap_drop': ('CapDrop', None), 'security_opt': ('SecurityOpt', None),
    'dns': ('Dns', []), 'dns_search': ('DnsSearch', []), 'extra_hosts': ('ExtraHosts', []),
    'sysctls': ('Sysctls', {}), 'init': ('Init', None), 'shm_size': ('ShmSize', 67108864),
}
HOST_DEFAULTS = {
    # These features have no supported Compose override in this narrowly scoped
    # preflight. Reject non-default runtime values rather than ignoring them.
    'IpcMode': 'private', 'PidMode': '', 'UTSMode': '', 'UsernsMode': '',
    'ContainerIDFile': '', 'CgroupParent': '', 'AutoRemove': False,
    'PublishAllPorts': False, 'OomScoreAdj': 0, 'OomKillDisable': False,
    'CpuRealtimePeriod': 0, 'CpuRealtimeRuntime': 0, 'BlkioWeight': 0,
}


def compare_runtime(service, document, runtime, image, path_map=None):
    config = service_config(document, service)
    unknown = sorted(set(config) - SUPPORTED)
    require_equal(service + '.compose.supported_fields', unknown, [])
    try:
        actual, host, defaults = runtime['Config'], runtime['HostConfig'], image['Config']
        for field, default in HOST_DEFAULTS.items():
            require_equal(service + '.host.default', host.get(field, default), default)
        for field in ('Devices', 'DeviceRequests', 'DeviceCgroupRules', 'VolumesFrom',
                      'Links', 'GroupAdd', 'Tmpfs', 'StorageOpt', 'BlkioWeightDevice',
                      'BlkioDeviceReadBps', 'BlkioDeviceWriteBps', 'BlkioDeviceReadIOps',
                      'BlkioDeviceWriteIOps'):
            if host.get(field) not in (None, [], {}):
                raise PreflightFailure(service + '.host.unsupported', host[field], None)
        require_equal(service + '.image.reference', actual['Image'], config['image'])
        require_equal(service + '.image.runtime_id', runtime['Image'], image['Id'])
        require_equal(service + '.state', [runtime['State']['Status'], runtime['RestartCount']], ['running', 0])
        if 'container_name' in config:
            require_equal(service + '.container_name', runtime['Name'].lstrip('/'), config['container_name'])
        env = environment_map(defaults.get('Env', []), service + '.image.environment')
        declared = config.get('environment', {})
        if not isinstance(declared, dict) or any(type(v) is not str for v in declared.values()):
            raise PreflightFailure(service + '.environment.values', declared, 'string values required')
        env.update(declared)
        require_equal(service + '.environment', environment_map(actual['Env'], service + '.environment'), env)
        for compose_key, inspect_key, default in [('command', 'Cmd', None), ('entrypoint', 'Entrypoint', None),
                                                  ('working_dir', 'WorkingDir', ''), ('user', 'User', ''),
                                                  ('stop_signal', 'StopSignal', '')]:
            expected = config.get(compose_key)
            if expected is None:
                expected = defaults.get(inspect_key, default)
            require_equal(service + '.config.' + compose_key, actual.get(inspect_key, default), expected)
        for key in ('hostname', 'domainname'):
            if key in config:
                require_equal(service + '.config.' + key, actual.get(key.title()), config[key])
        labels = {k: v for k, v in actual.get('Labels', {}).items() if not k.startswith('com.docker.compose.')}
        expected_labels = dict(defaults.get('Labels') or {})
        expected_labels.update(config.get('labels', {}))
        require_equal(service + '.labels', labels, expected_labels)
        expected_health = copy.deepcopy(defaults.get('Healthcheck', {}))
        health = config.get('healthcheck', {})
        if set(health) - {'test', 'interval', 'timeout', 'retries', 'start_period', 'start_interval', 'disable'}:
            raise PreflightFailure(service + '.healthcheck.supported', health, 'supported healthcheck')
        for k, v in health.items():
            if k == 'disable':
                if v:
                    expected_health = {'Test': ['NONE']}
                continue
            target = {'test': 'Test', 'interval': 'Interval', 'timeout': 'Timeout', 'retries': 'Retries',
                      'start_period': 'StartPeriod', 'start_interval': 'StartInterval'}[k]
            expected_health[target] = duration(v) if k in ('interval', 'timeout', 'start_period', 'start_interval') else v
        require_equal(service + '.healthcheck', actual.get('Healthcheck') or {}, expected_health)
        if 'stop_grace_period' in config:
            require_equal(service + '.stop_timeout', actual.get('StopTimeout'), duration(config['stop_grace_period']) // 1000000000)
        for key, (field, default) in HOST_FIELDS.items():
            expected = config.get(key, default)
            if key in ('mem_limit', 'memswap_limit', 'cpu_shares', 'cpu_period', 'cpu_quota', 'pids_limit', 'shm_size') and expected is not None:
                expected = int(expected)
            observed = host.get(field, default)
            # Docker versions encode unset collections as either null or empty.
            # Normalize only these collection fields, never environment/switch values.
            if key in ('cap_add', 'cap_drop', 'security_opt', 'dns', 'dns_search', 'extra_hosts', 'sysctls'):
                empty = {} if key == 'sysctls' else []
                if expected is None:
                    expected = empty
                if observed is None:
                    observed = empty
            require_equal(service + '.host.' + key, observed, expected)
        require_equal(service + '.host.cpus', host.get('NanoCpus', 0), int(float(config.get('cpus', 0)) * 1000000000))
        restart = config.get('restart', 'no')
        parts = restart.split(':')
        expected_restart = {'Name': parts[0], 'MaximumRetryCount': int(parts[1]) if len(parts) == 2 else 0}
        require_equal(service + '.restart', host.get('RestartPolicy'), expected_restart)
        log = config.get('logging', {'driver': 'json-file'})
        require_equal(service + '.logging', host.get('LogConfig'), {'Type': log['driver'], 'Config': log.get('options', {})})
        ports = {}
        for p in config.get('ports', []):
            if set(p) - {'target', 'published', 'host_ip', 'protocol', 'mode'} or p.get('mode', 'ingress') != 'ingress':
                raise PreflightFailure(service + '.ports.supported', p, 'simple published port')
            key = str(p['target']) + '/' + p.get('protocol', 'tcp')
            ports.setdefault(key, []).append({'HostIp': p.get('host_ip', ''), 'HostPort': str(p['published'])})
        require_equal(service + '.ports', host.get('PortBindings') or {}, ports)
        exposed = set(defaults.get('ExposedPorts') or {}) | set(ports)
        exposed.update(str(p) if '/' in str(p) else str(p) + '/tcp' for p in config.get('expose', []))
        require_equal(service + '.expose', sorted(actual.get('ExposedPorts') or {}), sorted(exposed))
        check_mounts(service, config, document, runtime, defaults, path_map)
        wanted_networks = config.get('networks', {'default': None})
        if not isinstance(wanted_networks, dict):
            raise PreflightFailure(service + '.networks', wanted_networks, 'normalized network mapping')
        actual_networks = runtime['NetworkSettings']['Networks']
        names = []
        for key, options in wanted_networks.items():
            if options and set(options) - {'aliases'}:
                raise PreflightFailure(service + '.networks.supported', options, 'aliases only')
            network_name = document['networks'][key]['name']
            names.append(network_name)
            aliases = (options or {}).get('aliases', [])
            if not set(aliases) <= set(actual_networks.get(network_name, {}).get('Aliases') or []):
                raise PreflightFailure(service + '.networks.aliases', 'different', 'required')
        require_equal(service + '.networks.names', sorted(actual_networks), sorted(names))
        require_equal(service + '.ulimits', host.get('Ulimits') or [],
                      [{'Name': k, 'Soft': v['soft'], 'Hard': v['hard']} for k, v in config.get('ulimits', {}).items()])
    except (KeyError, TypeError, ValueError, AttributeError):
        raise PreflightFailure(service + '.inspect.schema', 'missing', 'required') from None


def check_mounts(service, config, document, runtime, defaults, path_map):
    # docker inspect reports Config.Volumes as null (or {}) when the image declares none.
    image_volumes = defaults.get('Volumes') or {}
    if not isinstance(image_volumes, dict):
        raise PreflightFailure(service + '.mounts.image_volumes_schema', 'invalid', 'object or null')
    expected = {}
    for mount in config.get('volumes') or []:
        if set(mount) - {'type', 'source', 'target', 'read_only', 'bind', 'volume'}:
            raise PreflightFailure(service + '.mounts.supported', mount, 'simple bind or volume')
        if mount.get('bind', {}) not in ({}, {'create_host_path': True}):
            raise PreflightFailure(service + '.mounts.bind_options', mount, 'default bind options')
        if mount.get('volume', {}) not in ({},):
            raise PreflightFailure(service + '.mounts.volume_options', mount, 'default volume options')
        kind, source = mount['type'], mount['source']
        if kind == 'volume':
            source = document['volumes'][source]['name']
        elif kind == 'bind':
            if path_map:
                local, original = path_map
                source = project_path(source, local, original)
        else:
            raise PreflightFailure(service + '.mounts.type', kind, 'bind or volume')
        expected[mount['target']] = [kind, source, not mount.get('read_only', False)]
    actual = {}
    for mount in runtime['Mounts']:
        target = mount['Destination']
        if mount['Type'] == 'bind':
            require_equal(service + '.mounts.propagation', mount.get('Propagation', 'rprivate'), 'rprivate')
        if target not in expected and target in image_volumes:
            # Image-created anonymous volume identity is not deterministic.
            require_equal(service + '.mounts.image_volume', [mount['Type'], mount['RW']], ['volume', True])
            continue
        actual[target] = [mount['Type'], mount.get('Name') if mount['Type'] == 'volume' else mount['Source'], mount['RW']]
    require_equal(service + '.mounts', actual, expected)
    missing_image_volumes = set(image_volumes) - set(expected) - {m['Destination'] for m in runtime['Mounts']}
    require_equal(service + '.mounts.image_volume_presence', sorted(missing_image_volumes), [])


def check_guards(guards):
    """Original final preconditions, from saved facts only. No writes or SQL calls.

    permissionForecast must come from the original baseline/known-role forecast,
    not from selecting five desired grants. This offline consumer cannot attest
    freshness/authenticity of operator-collected facts or predict a live database.
    """
    expected = {'targetSha': APP_SHA, 'preparedTargetSha': APP_SHA, 'mysqlVersion': '8.0.45',
                'containerIdsMatch': True, 'allRunningNoRestarts': True, 'trackedDiff': False,
                'cachedDiff': False, 'enabledEvents': 0, 'xaRecoverEmpty': True,
                'tableEngines': {t: 'InnoDB' for t in TABLES},
                'pendingMigrations': sorted(APPROVED_MIGRATIONS), 'migrationHashes': APPROVED_MIGRATIONS}
    for key, value in expected.items():
        require_equal('guards.' + key, guards.get(key), value)
    archive = guards.get('archiveSha256')
    if not isinstance(archive, str) or not re.fullmatch('[a-f0-9]{64}', archive):
        raise PreflightFailure('guards.archive_hash', 'missing', 'required')
    require_equal('guards.prepared_archive_hash', guards.get('preparedArchiveSha256'), archive)
    disk = guards.get('freeDiskMiB')
    if type(disk) is not int or disk < 6144:
        raise PreflightFailure('guards.free_disk_mib', disk, 6144)
    for name, value in [('innodb_fast_shutdown', 1), ('log_bin_trust_function_creators', 0)]:
        actual = parse_switch(guards.get('globals', {}).get(name), 'globals.' + name)
        require_equal('globals.' + name, actual, value)
    forecast = guards.get('permissionForecast', {})
    require_equal('guards.permission_forecast.deleted', forecast.get('deleted'), [])
    require_equal('guards.permission_forecast.added', forecast.get('added'), sorted([list(p) for p in STRICT_ADDS]))
    require_equal('guards.permission_forecast.protected_roles', forecast.get('protectedRoles'), sorted(PROTECTED_ROLE_CODES))
    require_equal('guards.permission_forecast.warehouse_manager_count', forecast.get('warehouseManagerCount'), 0)


def preflight(evidence):
    check_guards(evidence.get('guards', {}))
    services = evidence.get('services', {})
    require_equal('evidence.services', sorted(services), ['backend', 'frontend', 'mysql'])
    verify_mysql_image(evidence.get('targetMysqlImageInspect', {}))
    for service in ('mysql', 'backend', 'frontend'):
        item = services[service]
        inputs, candidate_inputs, runtime = item['inputs'], item['candidateInputs'], item['inspect']
        validate_inputs(service, inputs, runtime)
        validate_inputs(service, candidate_inputs, runtime)
        current = compose_config(inputs)
        candidate = compose_config(candidate_inputs)
        require_equal(service + '.compose.project', runtime['Config']['Labels']['com.docker.compose.project'], current['name'])
        compare_candidate(service, current, candidate, inputs, candidate_inputs)
        compare_runtime(service, current, runtime, item['imageInspect'],
                        (str(Path(inputs['projectDirectory']).resolve()), inputs['workingDirectory']))
    return {'status': 'passed', 'check': 'offline.preconditions', 'scope': 'read-only snapshot verified',
            'targetSha': APP_SHA, 'productionMutationStarted': False, 'productionServiceMutationStarted': False}


def main(argv=None):
    # Disable argparse's raw argument/error echo; help contains only static text.
    parser = argparse.ArgumentParser(description=__doc__, exit_on_error=False)
    parser.add_argument('--evidence')
    try:
        args, unknown = parser.parse_known_args(argv)
        if unknown or not args.evidence:
            raise PreflightFailure('arguments.evidence', 'missing', 'required')
        try:
            evidence = json.loads(Path(args.evidence).read_text())
            if not isinstance(evidence, dict):
                raise ValueError()
        except (OSError, ValueError):
            raise PreflightFailure('evidence.read', 'unavailable', 'valid JSON object') from None
        result = preflight(evidence)
    except PreflightFailure as exc:
        print(json.dumps(exc.record, ensure_ascii=False))
        return 1
    except (Exception, KeyboardInterrupt):
        # Schema/argparse/programming errors also fail closed without a traceback.
        print(json.dumps(PreflightFailure('preflight.schema_or_internal_error', 'unavailable', 'required').record))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
