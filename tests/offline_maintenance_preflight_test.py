"""Offline preflight regression suite. All fixtures are synthetic; no daemon/server calls.

Run: python3 -B tests/offline_maintenance_preflight_test.py
Set PREFLIGHT_REAL_COMPOSE=1 to additionally exercise local `compose config`.
Set PREFLIGHT_REQUIRE_COMPOSE=1 (CI) to make those Docker tests mandatory: they
then fail instead of skipping when Docker Compose is unavailable.
"""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(os.environ.get('PREFLIGHT_SCRIPT', Path(__file__).resolve().parents[1] / 'scripts/offline_maintenance_preflight.py'))


def load():
    spec = importlib.util.spec_from_file_location('preflight', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TARGET = '415f70650da5cf575e3a1b9ed5e726e4a7aa1544'  # synthetic-use target; any 40-hex works
REQUIRE_COMPOSE = os.environ.get('PREFLIGHT_REQUIRE_COMPOSE') == '1'
REAL_COMPOSE = REQUIRE_COMPOSE or os.environ.get('PREFLIGHT_REAL_COMPOSE') == '1'


def real_compose(test):
    if REQUIRE_COMPOSE:
        def wrapper(self):
            probe = subprocess.run(['docker', 'compose', 'version'], capture_output=True, text=True)
            self.assertEqual(probe.returncode, 0, 'Docker Compose is required (PREFLIGHT_REQUIRE_COMPOSE=1)')
            return test(self)
        wrapper.__name__ = test.__name__
        return wrapper
    return unittest.skipUnless(REAL_COMPOSE, 'optional local Compose parser check')(test)


class LegacyRegression(unittest.TestCase):
    def test_command_failure_does_not_print_raw_stderr(self):
        # Isolate the original helper without executing its top-level server code.
        tree = ast.parse(SCRIPT.read_text())
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run')
        namespace = {'subprocess': subprocess}
        # New helper uses structured errors; imports/classes are safe after repair.
        if 'PreflightFailure' in SCRIPT.read_text():
            helper = load().run
        else:
            exec(compile(ast.Module(body=[node], type_ignores=[]), str(SCRIPT), 'exec'), namespace)
            helper = namespace['run']
        result = subprocess.CompletedProcess([], 2, '', 'password=synthetic-credential https://private.invalid token=synthetic-token')
        output = io.StringIO()
        with patch.object(subprocess, 'run', return_value=result), contextlib.redirect_stdout(output):
            try:
                helper(['docker', 'compose', 'config', '--format', 'json'])
            except Exception as exc:
                output.write(str(exc))
        self.assertNotIn('synthetic-credential', output.getvalue())
        self.assertNotIn('synthetic-token', output.getvalue())
        self.assertNotIn('private.invalid', output.getvalue())


class PreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = load()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.files = [self.root / 'main.yml', self.root / 'extra.yml']
        for file in self.files:
            file.write_text('services: {}\n')
        self.inputs = {'projectDirectory': str(self.root), 'workingDirectory': '/snapshot/app', 'projectName': 'fixture',
                       'files': [{'label': '/snapshot/app/main.yml', 'path': str(self.files[0])},
                                 {'label': '/snapshot/app/extra.yml', 'path': str(self.files[1])}],
                       'interpolation': {}}
        self.image = {'Id': 'sha256:' + 'a' * 64,
                      'Config': {'Env': ['PATH=/bin', 'FROM_IMAGE=default'], 'Cmd': ['start'],
                                 'Entrypoint': None, 'WorkingDir': '/app', 'User': '', 'Labels': {}}}
        self.service = {'image': 'fixture/backend:old', 'container_name': 'fixture-backend',
                        'restart': 'unless-stopped', 'environment': {'CORS_ALLOW_NULL_ORIGIN': '1', 'DB_PASSWORD': 'synthetic-secret'},
                        'networks': {'default': None}, 'logging': {'driver': 'json-file', 'options': {'max-size': '50m'}}}
        self.document = {'name': 'fixture', 'services': {'backend': self.service},
                         'networks': {'default': {'name': 'fixture_default'}}}
        self.runtime = {'Id': 'container-1', 'Name': '/fixture-backend', 'Image': self.image['Id'],
                        'State': {'Status': 'running'}, 'RestartCount': 0,
                        'Config': {'Image': self.service['image'], 'Env': ['PATH=/bin', 'FROM_IMAGE=default', 'CORS_ALLOW_NULL_ORIGIN=1', 'DB_PASSWORD=synthetic-secret'],
                                   'Cmd': ['start'], 'Entrypoint': None, 'WorkingDir': '/app', 'User': '',
                                   'Labels': {'com.docker.compose.project.config_files': '/snapshot/app/main.yml,/snapshot/app/extra.yml',
                                              'com.docker.compose.project.working_dir': '/snapshot/app',
                                              'com.docker.compose.service': 'backend', 'com.docker.compose.project': 'fixture'}},
                        'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0},
                                       'LogConfig': {'Type': 'json-file', 'Config': {'max-size': '50m'}},
                                       'PortBindings': {}, 'Memory': 0, 'MemorySwap': 0, 'NanoCpus': 0,
                                       'CpuShares': 0, 'CpuPeriod': 0, 'CpuQuota': 0, 'CpusetCpus': '',
                                       'PidsLimit': None, 'Privileged': False, 'ReadonlyRootfs': False,
                                       'CapAdd': None, 'CapDrop': None, 'SecurityOpt': None,
                                       'Dns': [], 'DnsSearch': [], 'ExtraHosts': [], 'Sysctls': {}},
                        'NetworkSettings': {'Networks': {'fixture_default': {'Aliases': ['fixture-backend', 'backend']}}},
                        'Mounts': []}

    def failure(self, fn, *args, **kwargs):
        with self.assertRaises(self.p.PreflightFailure) as caught:
            fn(*args, **kwargs)
        record = caught.exception.record
        for key in ('check', 'actual', 'expected', 'differences'):
            self.assertIn(key, record)
        self.assertTrue(record['differences'])
        return record

    def test_boolean_contract(self):
        for value in ('OFF', 'off', 'Off', '0', 0):
            self.assertEqual(self.p.parse_switch(value, 'global.switch'), 0)
        for value in ('ON', 'on', 'On', '1', 1):
            self.assertEqual(self.p.parse_switch(value, 'global.switch'), 1)
        for value in (True, False, None, '', ' ', ' ON ', 'true', 'false', 'yes', 'oﬀ', 'ＯＮ', '\nOFF', '2', 2, 0.0, [], {}):
            with self.subTest(value=value):
                self.failure(self.p.parse_switch, value, 'global.switch')

    def test_nested_type_changes_are_not_equal(self):
        self.failure(self.p.require_equal, 'config.drift', {'services': [{'privileged': 1}]}, {'services': [{'privileged': True}]})

    def test_effective_config_matches_inspect(self):
        self.p.compare_runtime('backend', self.document, self.runtime, self.image)

    def test_actual_environment_changes_are_rejected(self):
        self.runtime['Config']['Env'][2] = 'CORS_ALLOW_NULL_ORIGIN=0'
        record = self.failure(self.p.compare_runtime, 'backend', self.document, self.runtime, self.image)
        self.assertIn('CORS_ALLOW_NULL_ORIGIN', json.dumps(record))
        self.assertIn('environment', record['check'])

    def test_cors_literal_true_to_false_is_rejected(self):
        self.service['environment']['CORS_ALLOW_NULL_ORIGIN'] = 'true'
        self.runtime['Config']['Env'][2] = 'CORS_ALLOW_NULL_ORIGIN=false'
        self.failure(self.p.compare_runtime, 'backend', self.document, self.runtime, self.image)

    def test_environment_extra_or_missing_or_duplicate_is_rejected(self):
        for env in (self.runtime['Config']['Env'] + ['UNPLANNED=1'], self.runtime['Config']['Env'][1:],
                    self.runtime['Config']['Env'] + ['CORS_ALLOW_NULL_ORIGIN=1']):
            current = copy.deepcopy(self.runtime)
            current['Config']['Env'] = env
            self.failure(self.p.compare_runtime, 'backend', self.document, current, self.image)

    def test_unknown_compose_key_is_rejected(self):
        self.service['devices'] = ['/dev/example']
        self.failure(self.p.compare_runtime, 'backend', self.document, self.runtime, self.image)

    def test_docker_null_and_empty_unset_collections_are_equivalent(self):
        self.runtime['HostConfig'].update({'ExtraHosts': None, 'Sysctls': None, 'Dns': None,
                                          'DnsSearch': None, 'CapAdd': [], 'CapDrop': [], 'SecurityOpt': []})
        self.p.compare_runtime('backend', self.document, self.runtime, self.image)

    def test_runtime_settings_are_not_ignored(self):
        for key, changed in [('Memory', 100), ('Privileged', True), ('ReadonlyRootfs', True),
                             ('CapAdd', ['SYS_ADMIN']), ('NanoCpus', 100), ('Sysctls', {'net.example': '1'}),
                             ('IpcMode', 'host'), ('PublishAllPorts', True), ('OomKillDisable', True)]:
            current = copy.deepcopy(self.runtime)
            current['HostConfig'][key] = changed
            self.failure(self.p.compare_runtime, 'backend', self.document, current, self.image)
        current = copy.deepcopy(self.runtime)
        current['Config']['Cmd'] = ['different']
        self.failure(self.p.compare_runtime, 'backend', self.document, current, self.image)

    def test_image_reference_and_runtime_id_are_separate(self):
        image = copy.deepcopy(self.image)
        image['RepoDigests'] = ['fixture/backend@sha256:' + 'b' * 64]
        self.p.compare_runtime('backend', self.document, self.runtime, image)
        image['Id'] = 'sha256:' + 'c' * 64
        self.failure(self.p.compare_runtime, 'backend', self.document, self.runtime, image)

    def test_labels_select_ordered_files_and_never_guess_prod(self):
        self.p.validate_inputs('backend', self.inputs, self.runtime)
        for labels in ('/snapshot/app/main.yml,/snapshot/app/prod.yml', '/snapshot/app/extra.yml,/snapshot/app/main.yml', ''):
            current = copy.deepcopy(self.runtime)
            current['Config']['Labels']['com.docker.compose.project.config_files'] = labels
            self.failure(self.p.validate_inputs, 'backend', self.inputs, current)
        self.inputs['projectName'] = 'different-project'
        self.failure(self.p.validate_inputs, 'backend', self.inputs, self.runtime)
        self.inputs['files'] = []
        self.failure(self.p.validate_inputs, 'backend', self.inputs, self.runtime)

    def test_compose_command_uses_explicit_files_and_frozen_env(self):
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(self.document), '')) as mocked:
            self.assertEqual(self.p.compose_config(self.inputs), self.document)
        args = mocked.call_args.args[0]
        self.assertEqual([args[i+1] for i,x in enumerate(args) if x == '-f'], [str(p.resolve()) for p in self.files])
        self.assertEqual(args[-3:], ['config', '--format', 'json'])
        self.assertNotIn('DOCKER_HOST', mocked.call_args.kwargs['env'])
        self.assertNotIn('COMPOSE_FILE', mocked.call_args.kwargs['env'])
        self.assertIn('--env-file', args)
        self.assertEqual(args[args.index('--project-name') + 1], 'fixture')

    def test_command_failure_bad_json_and_missing_service_stop(self):
        for result in (subprocess.CompletedProcess([], 2, '', 'password=synthetic-secret https://private.invalid'),
                       subprocess.CompletedProcess([], 0, 'invalid-json-secret', ''),
                       subprocess.CompletedProcess([], 0, '[]', '')):
            with patch.object(subprocess, 'run', return_value=result):
                record = self.failure(self.p.compose_config, self.inputs)
            text = json.dumps(record)
            self.assertNotIn('synthetic-secret', text)
            self.assertNotIn('private.invalid', text)
            self.assertNotIn('invalid-json-secret', text)
        self.failure(self.p.compare_runtime, 'frontend', self.document, self.runtime, self.image)
        with patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired(['secret'], 1, stderr='synthetic-secret')):
            record = self.failure(self.p.compose_config, self.inputs)
        self.assertNotIn('synthetic-secret', json.dumps(record))

    def test_redaction_covers_nested_keys_values_and_exceptions(self):
        actual = {'environment': {'DB_PASSWORD': 'synthetic-secret', 'CORS_ALLOW_NULL_ORIGIN': '0'},
                  'synthetic-key-secret': {'token': 'synthetic-token', 'server': 'private.invalid'},
                  'numeric-secret': 87654321012345,
                  'stderr': 'token=synthetic-token https://private.invalid'}
        record = self.failure(self.p.require_equal, 'config.drift', actual, {'environment': {'CORS_ALLOW_NULL_ORIGIN': '1'}})
        serialized = json.dumps(record)
        for value in ('synthetic-secret', 'synthetic-key-secret', 'synthetic-token', 'private.invalid'):
            self.assertNotIn(value, serialized)
        self.assertIn('CORS_ALLOW_NULL_ORIGIN', serialized)
        self.assertIn('different', serialized)
        self.assertNotIn('87654321012345', serialized)
        changed = self.failure(self.p.require_equal, 'config.drift', {'environment': {'DB_PASSWORD': 87654321012345}}, {'environment': {'DB_PASSWORD': 87654321012346}})
        self.assertNotIn('87654321012345', json.dumps(changed))

    def test_only_verified_mysql_image_transition_is_allowed(self):
        current = {'services': {'mysql': {'image': 'flowcube-mysql-current:8.0.45', 'environment': {'TZ': 'Asia/Shanghai'}}}}
        candidate = copy.deepcopy(current)
        candidate['services']['mysql']['image'] = self.p.MYSQL_TARGET
        candidate['services']['mysql']['pull_policy'] = 'never'
        self.p.compare_candidate('mysql', current, candidate)
        for image in ('mysql:8.0.47', 'mysql:8.0.46@sha256:' + 'f'*64, 'other/mysql:8.0.46',
                      'docker.io/library/mysql:8.0.46@' + self.p.MYSQL_INDEX_DIGEST):
            candidate['services']['mysql']['image'] = image
            self.failure(self.p.compare_candidate, 'mysql', current, candidate)
        candidate['services']['mysql']['image'] = self.p.MYSQL_TARGET
        for field, value in [('environment', {'TZ': 'UTC'}), ('command', ['--skip-log-bin']), ('ports', [])]:
            bad = copy.deepcopy(candidate)
            bad['services']['mysql'][field] = value
            self.failure(self.p.compare_candidate, 'mysql', current, bad)
        bad = copy.deepcopy(candidate)
        bad['volumes'] = {'unapproved': {}}
        self.failure(self.p.compare_candidate, 'mysql', current, bad)
        self.failure(self.p.compare_candidate, 'backend', self.document,
                     {**self.document, 'name': 'changed'})

    def test_mysql_target_digest_layers_are_checked_against_their_own_layer(self):
        image = {'Id': self.p.MYSQL_IMAGE_ID, 'RepoTags': ['mysql:8.0.46'], 'RepoDigests': [],
                 'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Env': ['MYSQL_VERSION=8.0.46-1.el9']}}
        self.p.verify_mysql_image(image)
        for key,value in [('Id', self.p.MYSQL_INDEX_DIGEST), ('Id', 'sha256:' + 'e'*64),
                          ('RepoTags', []), ('RepoTags', ['mysql:8.0.45']), ('Architecture', 'arm64')]:
            bad = copy.deepcopy(image)
            bad[key] = value
            self.failure(self.p.verify_mysql_image, bad)

    def test_mysql_pin_uses_local_image_without_registry_pull(self):
        current = {'services': {'mysql': {'image': 'flowcube-mysql-current:8.0.45'}}}
        good = {'services': {'mysql': {'image': self.p.MYSQL_TARGET, 'pull_policy': 'never'}}}
        self.p.compare_candidate('mysql', current, good)
        # Counter-examples: the old registry@digest proposal, a missing pull policy,
        # or any policy that may contact the registry must all be rejected.
        old_proposal = {'services': {'mysql': {'image': 'docker.io/library/mysql:8.0.46@' + self.p.MYSQL_INDEX_DIGEST}}}
        self.failure(self.p.compare_candidate, 'mysql', current, old_proposal)
        for policy in (None, 'always', 'missing', 'if_not_present', 'build'):
            bad = copy.deepcopy(good)
            if policy is None:
                del bad['services']['mysql']['pull_policy']
            else:
                bad['services']['mysql']['pull_policy'] = policy
            self.failure(self.p.compare_candidate, 'mysql', current, bad)
        # A file-loaded image has no RepoDigests and must still verify by image ID.
        loaded = {'Id': self.p.MYSQL_IMAGE_ID, 'RepoTags': ['mysql:8.0.46'], 'Os': 'linux',
                  'Architecture': 'amd64', 'Config': {'Env': ['MYSQL_VERSION=8.0.46-1.el9']}}
        self.p.verify_mysql_image(loaded)
        impostor = dict(loaded, Id='sha256:' + 'd'*64)
        self.failure(self.p.verify_mysql_image, impostor)

    def test_cli_errors_are_structured_and_silent_about_paths(self):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            status = self.p.main(['--evidence', '/private/synthetic-secret/absent.json'])
        self.assertEqual(status, 1)
        self.assertEqual(errors.getvalue(), '')
        record = json.loads(output.getvalue())
        self.assertEqual(record['status'], 'failed')
        self.assertNotIn('synthetic-secret', output.getvalue())

    def test_import_never_runs_subprocesses(self):
        with patch.object(subprocess, 'run', side_effect=AssertionError('import ran a command')):
            load()

    def test_original_preconditions_preserved_and_fail_closed(self):
        guards = {
            'targetSha': TARGET, 'preparedTargetSha': TARGET,
            'archiveSha256': 'a'*64, 'preparedArchiveSha256': 'a'*64,
            'mysqlVersion': '8.0.45', 'containerIdsMatch': True, 'allRunningNoRestarts': True,
            'trackedDiff': False, 'cachedDiff': False, 'freeDiskMiB': 7000,
            'enabledEvents': 0, 'xaRecoverEmpty': True,
            'tableEngines': {t: 'InnoDB' for t in self.p.TABLES},
            'pendingMigrations': sorted(self.p.APPROVED_MIGRATIONS),
            'migrationHashes': self.p.APPROVED_MIGRATIONS,
            'globals': {'innodb_fast_shutdown': '1', 'log_bin_trust_function_creators': 'OFF'},
            'permissionForecast': {'deleted': [], 'added': sorted([list(p) for p in self.p.STRICT_ADDS]),
                                   'protectedRoles': sorted(self.p.PROTECTED_ROLE_CODES), 'warehouseManagerCount': 0}}
        self.p.check_guards(guards, TARGET)
        for key, value in [('mysqlVersion', '8.0.46'), ('freeDiskMiB', 5000), ('enabledEvents', 1),
                           ('pendingMigrations', []), ('targetSha', 'b'*40), ('containerIdsMatch', False)]:
            bad = copy.deepcopy(guards)
            bad[key] = value
            self.failure(self.p.check_guards, bad, TARGET)
        bad = copy.deepcopy(guards)
        bad['permissionForecast']['deleted'] = [['sales', 'example']]
        self.failure(self.p.check_guards, bad, TARGET)
        bad = copy.deepcopy(guards)
        bad['permissionForecast']['added'] += [['sales', 'example']]
        self.failure(self.p.check_guards, bad, TARGET)
        self.failure(self.p.check_guards, {}, TARGET)

    def guards(self):
        return {
            'targetSha': TARGET, 'preparedTargetSha': TARGET,
            'archiveSha256': 'a'*64, 'preparedArchiveSha256': 'a'*64,
            'mysqlVersion': '8.0.45', 'containerIdsMatch': True, 'allRunningNoRestarts': True,
            'trackedDiff': False, 'cachedDiff': False, 'freeDiskMiB': 7000,
            'enabledEvents': 0, 'xaRecoverEmpty': True,
            'tableEngines': {t: 'InnoDB' for t in self.p.TABLES},
            'pendingMigrations': sorted(self.p.APPROVED_MIGRATIONS),
            'migrationHashes': self.p.APPROVED_MIGRATIONS,
            'globals': {'innodb_fast_shutdown': 'ON', 'log_bin_trust_function_creators': '0'},
            'permissionForecast': {'deleted': [], 'added': sorted([list(p) for p in self.p.STRICT_ADDS]),
                                   'protectedRoles': sorted(self.p.PROTECTED_ROLE_CODES), 'warehouseManagerCount': 0}}

    def bundle(self):
        services = {}
        documents = {}
        for name in ('mysql', 'backend', 'frontend'):
            config, runtime, image = copy.deepcopy(self.service), copy.deepcopy(self.runtime), copy.deepcopy(self.image)
            config['image'] = 'flowcube-mysql-current:8.0.45' if name == 'mysql' else 'fixture/' + name + ':old'
            config['container_name'] = 'fixture-' + name
            runtime['Name'] = '/fixture-' + name
            runtime['Config']['Image'] = config['image']
            runtime['Config']['Labels']['com.docker.compose.service'] = name
            inputs = copy.deepcopy(self.inputs)
            if name == 'mysql':
                inputs['files'][1]['label'] = '/snapshot/app/pin-10-19.yml'
                runtime['Config']['Labels']['com.docker.compose.project.config_files'] = '/snapshot/app/main.yml,/snapshot/app/pin-10-19.yml'
            services[name] = {'inputs': inputs, 'candidateInputs': copy.deepcopy(inputs),
                              'inspect': runtime, 'imageInspect': image}
            documents[name] = {'name': 'fixture', 'services': {name: config},
                               'networks': {'default': {'name': 'fixture_default'}}}
        target = {'Id': self.p.MYSQL_IMAGE_ID, 'RepoTags': ['mysql:8.0.46'], 'RepoDigests': [],
                  'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Env': ['MYSQL_VERSION=8.0.46-1.el9']}}
        bundle = {'guards': self.guards(), 'services': services, 'targetMysqlImageInspect': target}
        outputs = []
        for name in ('mysql', 'backend', 'frontend'):
            candidate = copy.deepcopy(documents[name])
            if name == 'mysql':
                candidate['services'][name]['image'] = self.p.MYSQL_TARGET
                candidate['services'][name]['pull_policy'] = 'never'
            outputs.extend([documents[name], candidate])
        return bundle, outputs

    def test_whole_preflight_accepts_exact_three_service_combinations(self):
        bundle, outputs = self.bundle()
        with patch.object(self.p, 'compose_config', side_effect=outputs) as compose:
            result = self.p.preflight(bundle, TARGET)
        self.assertEqual(compose.call_count, 6)
        self.assertEqual(result['status'], 'passed')
        self.assertFalse(result['productionMutationStarted'])

    def test_whole_preflight_uses_snapshot_path_projection(self):
        bundle, outputs = self.bundle()
        candidate_root = self.root / 'candidate'
        candidate_root.mkdir()
        for name, item in bundle['services'].items():
            item['candidateInputs']['projectDirectory'] = str(candidate_root)
        for index, document in enumerate(outputs):
            root = self.root if index % 2 == 0 else candidate_root
            for config in document['services'].values():
                config['build'] = {'context': str(root.resolve() / 'build'), 'dockerfile': 'Dockerfile'}
        with patch.object(self.p, 'compose_config', side_effect=outputs):
            self.assertEqual(self.p.preflight(bundle, TARGET)['status'], 'passed')

    def test_success_does_not_write_evidence_or_input_files(self):
        bundle, outputs = self.bundle()
        evidence_file = self.root / 'evidence.json'
        evidence_file.write_text(json.dumps(bundle))
        paths = [evidence_file] + self.files
        before = {str(p): p.read_bytes() for p in paths}
        output = io.StringIO()
        with patch.object(self.p, 'compose_config', side_effect=outputs), \
                patch.object(self.p, 'verify_target_scope') as scope, contextlib.redirect_stdout(output):
            self.assertEqual(self.p.main(['--evidence', str(evidence_file), '--target-sha', TARGET]), 0)
        scope.assert_called_once()
        self.assertEqual(scope.call_args[0][0], TARGET)
        self.assertEqual({str(p): p.read_bytes() for p in paths}, before)
        self.assertEqual(json.loads(output.getvalue())['status'], 'passed')

    def test_whole_preflight_wrong_prod_content_and_merge_env_stop(self):
        for value in ('0', 'false'):
            bundle, outputs = self.bundle()
            # Label declarations alone cannot hide wrong file content or merge precedence.
            for document in outputs[2:4]:
                document['services']['backend']['environment']['CORS_ALLOW_NULL_ORIGIN'] = value
            with patch.object(self.p, 'compose_config', side_effect=outputs) as compose:
                record = self.failure(self.p.preflight, bundle, TARGET)
            self.assertEqual(record['check'], 'backend.environment')
            self.assertEqual(compose.call_count, 4)  # frontend is never evaluated after failure

    def test_whole_preflight_wrong_prod_labels_stop_before_commands(self):
        bundle, outputs = self.bundle()
        for key in ('inputs', 'candidateInputs'):
            bundle['services']['mysql'][key]['files'][1]['label'] = '/snapshot/app/prod.yml'
        with patch.object(self.p, 'compose_config', side_effect=outputs) as compose:
            self.failure(self.p.preflight, bundle, TARGET)
        compose.assert_not_called()

    def test_all_cli_schema_failures_hide_untrusted_input(self):
        evidence = self.root / 'evidence.json'
        for value in ('invalid-synthetic-secret', '[]', '{}', '{"guards": "synthetic-secret"}'):
            evidence.write_text(value)
            output, errors = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors), \
                    patch.object(self.p, 'verify_target_scope'):
                self.assertEqual(self.p.main(['--evidence', str(evidence), '--target-sha', TARGET]), 1)
            self.assertEqual(json.loads(output.getvalue())['status'], 'failed')
            self.assertNotIn('synthetic-secret', output.getvalue() + errors.getvalue())
            self.assertEqual(errors.getvalue(), '')

    def test_runtime_mount_port_logging_and_health_drift(self):
        for field, value in [('Mounts', [{'Type': 'bind', 'Source': '/sensitive', 'Destination': '/app', 'RW': True}])]:
            changed = copy.deepcopy(self.runtime)
            changed[field] = value
            self.failure(self.p.compare_runtime, 'backend', self.document, changed, self.image)
        for field,value in [('PortBindings', {'3000/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '3000'}]}),
                           ('LogConfig', {'Type': 'none', 'Config': {}})]:
            changed = copy.deepcopy(self.runtime)
            changed['HostConfig'][field] = value
            self.failure(self.p.compare_runtime, 'backend', self.document, changed, self.image)
        changed = copy.deepcopy(self.runtime)
        changed['Config']['Healthcheck'] = {'Test': ['NONE']}
        self.failure(self.p.compare_runtime, 'backend', self.document, changed, self.image)

    def test_null_or_empty_volumes_mean_no_volumes(self):
        for image_volumes in (None, {}):
            for compose_volumes in (None, []):
                image = copy.deepcopy(self.image)
                image['Config']['Volumes'] = image_volumes
                document = copy.deepcopy(self.document)
                document['services']['backend']['volumes'] = compose_volumes
                self.p.compare_runtime('backend', document, self.runtime, image)
        # Counter-examples: a real unexpected volume still fails.
        image = copy.deepcopy(self.image)
        image['Config']['Volumes'] = None
        changed = copy.deepcopy(self.runtime)
        changed['Mounts'] = [{'Type': 'volume', 'Name': 'surprise', 'Source': '/var/lib/docker/volumes/surprise',
                              'Destination': '/data', 'RW': True}]
        self.failure(self.p.compare_runtime, 'backend', self.document, changed, image)
        image['Config']['Volumes'] = {'/data': {}}
        self.failure(self.p.compare_runtime, 'backend', self.document, self.runtime, image)
        image['Config']['Volumes'] = ['/data']
        self.failure(self.p.compare_runtime, 'backend', self.document, self.runtime, image)

    def test_realistic_health_ports_mounts_and_limits_match(self):
        self.service.update({'ports': [{'target': 3000, 'published': '3000', 'host_ip': '127.0.0.1', 'protocol': 'tcp', 'mode': 'ingress'}],
                             'healthcheck': {'test': ['CMD', 'check'], 'interval': '1m30s', 'retries': 3},
                             'stop_grace_period': '30s', 'mem_limit': '1073741824', 'cpus': 1.0,
                             'volumes': [{'type': 'bind', 'source': str(self.root.resolve()) + '/config',
                                          'target': '/etc/config', 'read_only': True, 'bind': {'create_host_path': True}},
                                         {'type': 'volume', 'source': 'data', 'target': '/data'},
                                         {'type': 'bind', 'source': str(self.root.resolve()), 'target': '/snapshot-root', 'read_only': True}]})
        self.document['volumes'] = {'data': {'name': 'fixture_data'}}
        self.runtime['HostConfig'].update({'PortBindings': {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3000'}]},
                                          'Memory': 1073741824, 'NanoCpus': 1000000000})
        self.runtime['Config'].update({'ExposedPorts': {'3000/tcp': {}}, 'StopTimeout': 30,
                                      'Healthcheck': {'Test': ['CMD', 'check'], 'Interval': 90000000000, 'Retries': 3}})
        self.runtime['Mounts'] = [{'Type': 'bind', 'Source': '/snapshot/app/config', 'Destination': '/etc/config', 'RW': False},
                                  {'Type': 'volume', 'Source': '/engine/internal', 'Name': 'fixture_data', 'Destination': '/data', 'RW': True},
                                  {'Type': 'bind', 'Source': '/snapshot/app', 'Destination': '/snapshot-root', 'RW': False}]
        self.p.compare_runtime('backend', self.document, self.runtime, self.image, (str(self.root.resolve()), '/snapshot/app'))

    @real_compose
    def test_two_snapshot_directories_preserve_path_semantics_and_reject_real_changes(self):
        inputs = []
        for directory, image in [('current', 'flowcube-mysql-current:8.0.45'), ('candidate', self.p.MYSQL_TARGET + '\n    pull_policy: never')]:
            root = self.root / directory
            root.mkdir()
            (root / 'build').mkdir()
            file = root / 'main.yml'
            file.write_text('services:\n  mysql:\n    image: ' + image + '\n'
                            '    build:\n      context: ./build\n      dockerfile: Dockerfile\n'
                            '    volumes:\n      - ./data:/data\n      - ./:/app\n')
            entry = copy.deepcopy(self.inputs)
            entry['projectDirectory'] = str(root)
            entry['files'] = [{'label': '/snapshot/app/main.yml', 'path': str(file)}]
            inputs.append(entry)
        current, candidate = [self.p.compose_config(value) for value in inputs]
        # The genuine failure in the previous implementation is independent of
        # parser formatting: Docker has made two equal relative paths absolute.
        self.assertNotEqual(current['services']['mysql']['build']['context'],
                            candidate['services']['mysql']['build']['context'])
        self.p.compare_candidate('mysql', current, candidate, *inputs)
        original = (self.root / 'candidate/main.yml').read_text()
        for changed in (original.replace('./data:/data', './other-data:/data'),
                        original.replace('context: ./build', 'context: ./other-build'),
                        original.replace('dockerfile: Dockerfile', 'dockerfile: Otherfile'),
                        original.replace('./data:/data', str(self.root / 'candidate-other/data') + ':/data'),
                        original.replace('./data:/data', '/external/changed-data:/data')):
            (self.root / 'candidate/main.yml').write_text(changed)
            changed_document = self.p.compose_config(inputs[1])
            self.failure(self.p.compare_candidate, 'mysql', current, changed_document, *inputs)
        external_current, external_candidate = copy.deepcopy(current), copy.deepcopy(candidate)
        for document in (external_current, external_candidate):
            document['services']['mysql']['volumes'][0]['source'] = '/external/unchanged-data'
        self.p.compare_candidate('mysql', external_current, external_candidate, *inputs)
        # Relocation must never rewrite arbitrary env/command strings.
        changed_document = copy.deepcopy(candidate)
        changed_document['services']['mysql']['environment'] = {'DATA_PATH': str(self.root / 'candidate/data')}
        current_with_env = copy.deepcopy(current)
        current_with_env['services']['mysql']['environment'] = {'DATA_PATH': '/snapshot/app/data'}
        self.failure(self.p.compare_candidate, 'mysql', current_with_env, changed_document, *inputs)

    @real_compose
    def test_real_compose_merge_indentation_and_wrong_prod(self):
        for indent in (2, 4):
            self.files[0].write_text('services:\n' + ' '*indent + 'backend:\n' + ' '*(indent*2) + 'image: fixture/backend:old\n' +
                                     ' '*(indent*2) + 'environment:\n' + ' '*(indent*3) + 'CORS_ALLOW_NULL_ORIGIN: "0"\n' +
                                     ' '*indent + 'frontend:\n' + ' '*(indent*2) + 'image: fixture/frontend:old\n')
            self.files[1].write_text('services:\n  backend:\n    environment:\n      CORS_ALLOW_NULL_ORIGIN: "1"\n')
            merged = self.p.compose_config(self.inputs)
            self.assertIn('frontend', merged['services'])
            self.assertEqual(merged['services']['backend']['environment']['CORS_ALLOW_NULL_ORIGIN'], '1')
            self.files[1].write_text('services:\n  backend:\n    environment:\n      CORS_ALLOW_NULL_ORIGIN: "0"\n')
            wrong = self.p.compose_config(self.inputs)
            self.failure(self.p.compare_candidate, 'backend', merged, wrong)


class TargetShaContract(unittest.TestCase):
    """Release target is passed in; business code must equal the reviewed baseline."""

    @classmethod
    def setUpClass(cls):
        cls.p = load()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t',
                        GIT_COMMITTER_EMAIL='t@t', GIT_CONFIG_NOSYSTEM='1')
        self.git('init', '-q')
        (self.repo / 'backend').mkdir()
        (self.repo / 'backend/app.js').write_text('business\n')
        self.baseline = self.commit('baseline')

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo)] + list(args), check=True, env=self.env,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, message):
        self.git('add', '-A')
        self.git('commit', '-q', '--allow-empty', '-m', message)
        return self.git('rev-parse', 'HEAD')

    def scope(self, target):
        with patch.object(self.p, 'BUSINESS_BASELINE_SHA', self.baseline):
            return self.p.verify_target_scope(target, self.repo)

    def failure(self, fn, *args):
        with self.assertRaises(self.p.PreflightFailure) as caught:
            fn(*args)
        return caught.exception.record

    def test_no_hardcoded_release_sha_remains(self):
        self.assertFalse(hasattr(self.p, 'APP_SHA'))
        self.assertEqual(self.p.BUSINESS_BASELINE_SHA, '734ed9924a3b6d3051962a3f06f81f5a04fc4213')
        source = SCRIPT.read_text()
        shas = set(__import__('re').findall(r'\b[0-9a-f]{40}\b', source))
        self.assertEqual(shas, {self.p.BUSINESS_BASELINE_SHA})

    def test_happy_path_only_preflight_files_changed(self):
        for name in sorted(self.p.TARGET_ALLOWED_CHANGES):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('tooling\n')
        target = self.commit('tooling')
        self.assertEqual(self.scope(target), sorted(self.p.TARGET_ALLOWED_CHANGES))
        self.assertEqual(self.scope(self.baseline), [])

    def test_business_file_change_is_rejected(self):
        (self.repo / 'scripts').mkdir()
        (self.repo / 'scripts/offline_maintenance_preflight.py').write_text('tooling\n')
        (self.repo / 'backend/app.js').write_text('changed business\n')
        record = self.failure(self.scope, self.commit('sneaky'))
        self.assertEqual(record['check'], 'target.business_changes_since_baseline')

    def test_added_or_deleted_business_file_is_rejected(self):
        (self.repo / 'backend/new.js').write_text('x\n')
        self.failure(self.scope, self.commit('add'))
        self.git('reset', '-q', '--hard', self.baseline)
        (self.repo / 'backend/app.js').unlink()
        self.failure(self.scope, self.commit('delete'))

    LOCK = 'frontend/package-lock.json'

    def write_lock(self, packages, extra=None):
        path = self.repo / self.LOCK
        path.parent.mkdir(parents=True, exist_ok=True)
        doc = {'name': 'flowcube-frontend', 'lockfileVersion': 3, 'packages': packages}
        doc.update(extra or {})
        path.write_text(json.dumps(doc, indent=2) + '\n')

    def lock_baseline(self):
        self.packages = {
            '': {'name': 'flowcube-frontend', 'dependencies': {'axios': '^1.0.0'}},
            'node_modules/axios': {'version': '1.20.0', 'integrity': 'sha512-a'},
            'node_modules/follow-redirects': {'version': '1.16.0', 'resolved': 'https://r/fr-1.16.0.tgz',
                                              'integrity': 'sha512-old', 'license': 'MIT'},
        }
        self.write_lock(self.packages)
        self.baseline = self.commit('lock baseline')

    def bumped(self):
        packages = copy.deepcopy(self.packages)
        packages['node_modules/follow-redirects'].update(
            version='1.16.1', resolved='https://r/fr-1.16.1.tgz', integrity='sha512-new')
        return packages

    def test_lockfile_only_follow_redirects_bump_passes(self):
        self.lock_baseline()
        self.write_lock(self.bumped())
        self.assertEqual(self.scope(self.commit('bump')), [self.LOCK])

    def test_lockfile_other_package_change_is_rejected(self):
        self.lock_baseline()
        packages = self.bumped()
        packages['node_modules/axios']['version'] = '1.21.0'
        record = self.failure(self.scope, self.commit_lock(packages))
        self.assertEqual(record['check'], 'target.lockfile_other_packages')

    def test_lockfile_added_package_is_rejected(self):
        self.lock_baseline()
        packages = self.bumped()
        packages['node_modules/evil'] = {'version': '1.0.0'}
        self.assertEqual(self.failure(self.scope, self.commit_lock(packages))['check'],
                         'target.lockfile_other_packages')

    def test_lockfile_allowed_package_extra_field_change_is_rejected(self):
        self.lock_baseline()
        packages = self.bumped()
        packages['node_modules/follow-redirects']['dependencies'] = {'evil': '*'}
        self.assertEqual(self.failure(self.scope, self.commit_lock(packages))['check'],
                         'target.lockfile_allowed_package_fields')

    def test_lockfile_top_level_change_is_rejected(self):
        self.lock_baseline()
        self.write_lock(self.bumped(), {'requires': False})
        self.assertEqual(self.failure(self.scope, self.commit('top'))['check'], 'target.lockfile_other_fields')

    def test_lockfile_bump_with_business_change_still_rejected(self):
        self.lock_baseline()
        self.write_lock(self.bumped())
        (self.repo / 'backend/app.js').write_text('changed business\n')
        self.assertEqual(self.failure(self.scope, self.commit('mixed'))['check'],
                         'target.business_changes_since_baseline')

    def test_other_lockfile_is_not_allowlisted(self):
        (self.repo / 'backend/package-lock.json').write_text('{}\n')
        self.assertEqual(self.failure(self.scope, self.commit('backend lock'))['check'],
                         'target.business_changes_since_baseline')

    def commit_lock(self, packages):
        self.write_lock(packages)
        return self.commit('lock change')

    def test_unknown_target_or_missing_repo_fails_closed(self):
        self.assertEqual(self.failure(self.scope, 'f' * 40)['check'], 'target.git_diff')
        with patch.object(self.p, 'BUSINESS_BASELINE_SHA', self.baseline):
            self.failure(self.p.verify_target_scope, self.baseline, self.repo / 'absent')

    def test_invalid_target_is_rejected_before_git(self):
        with patch.object(subprocess, 'run', side_effect=AssertionError('ran git')):
            for bad in (None, '', '415f7065', 'g' * 40, 'HEAD', '--output=x'):
                self.assertEqual(self.failure(self.p.verify_target_scope, bad, self.repo)['check'], 'target.sha')

    def run_main(self, argv, env_target=None):
        env = {k: v for k, v in os.environ.items() if k != self.p.TARGET_SHA_ENV}
        if env_target:
            env[self.p.TARGET_SHA_ENV] = env_target
        output, errors = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(output), \
                contextlib.redirect_stderr(errors):
            status = self.p.main(argv)
        self.assertEqual(errors.getvalue(), '')
        return status, json.loads(output.getvalue())

    def test_missing_target_fails_closed(self):
        evidence = self.repo / 'evidence.json'
        evidence.write_text('{}')
        with patch.object(self.p, 'preflight', side_effect=AssertionError('ran without target')):
            status, record = self.run_main(['--evidence', str(evidence)])
        self.assertEqual(status, 1)
        self.assertEqual(record['check'], 'arguments.target_sha')

    def test_target_from_env_and_conflict(self):
        evidence = self.repo / 'evidence.json'
        evidence.write_text('{}')
        with patch.object(self.p, 'BUSINESS_BASELINE_SHA', self.baseline), \
                patch.object(self.p, 'preflight', return_value={'status': 'passed'}) as run:
            status, _ = self.run_main(['--evidence', str(evidence), '--repo', str(self.repo)], self.baseline)
            self.assertEqual(status, 0)
            self.assertEqual(run.call_args[0][1], self.baseline)
            status, record = self.run_main(['--evidence', str(evidence), '--repo', str(self.repo),
                                            '--target-sha', 'a' * 40], self.baseline)
        self.assertEqual((status, record['check']), (1, 'arguments.target_sha'))

    def test_business_change_blocks_cli_before_evidence(self):
        (self.repo / 'backend/app.js').write_text('changed\n')
        target = self.commit('business')
        with patch.object(self.p, 'BUSINESS_BASELINE_SHA', self.baseline), \
                patch.object(self.p, 'preflight', side_effect=AssertionError('evidence checked')):
            status, record = self.run_main(['--evidence', '/absent.json', '--repo', str(self.repo),
                                            '--target-sha', target])
        self.assertEqual((status, record['check']), (1, 'target.business_changes_since_baseline'))

    def test_target_must_match_release_data(self):
        guards = {'targetSha': 'b' * 40, 'preparedTargetSha': 'b' * 40}
        self.assertEqual(self.failure(self.p.check_guards, guards, 'a' * 40)['check'], 'guards.targetSha')
        guards = {'targetSha': 'a' * 40, 'preparedTargetSha': 'b' * 40}
        self.assertEqual(self.failure(self.p.check_guards, guards, 'a' * 40)['check'], 'guards.preparedTargetSha')
        self.failure(self.p.check_guards, {}, None)


if __name__ == '__main__':
    unittest.main()
