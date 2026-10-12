import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { detectAgent } from '../../src/runtimes/detection.js';
import { kiloAgentDef } from '../../src/runtimes/defs/kilo.js';

const execFileAsync = promisify(execFile);
const mockBin = fileURLToPath(new URL('../../../../mocks/bin/kilo', import.meta.url));
const posixTest = process.platform === 'win32' ? test.skip : test;

afterEach(() => vi.unstubAllEnvs());

posixTest('Kilo mock reports a supported version without recordings or ACP input', async () => {
  const emptyRecordings = await mkdtemp(path.join(tmpdir(), 'od-kilo-mock-version-'));
  try {
    const { stdout, stderr } = await execFileAsync(mockBin, ['--version'], {
      env: {
        ...process.env,
        OD_MOCKS_RECORDINGS_DIR: emptyRecordings,
        OD_MOCKS_TRACE: 'missing-recording',
      },
      timeout: 3_000,
    });
    const version = kiloAgentDef.versionPolicy.parse(stdout);
    expect(version).toBe('7.4.23');
    expect(kiloAgentDef.versionPolicy.supportedVersions).toContain(version);
    expect(stderr).toBe('');
  } finally {
    await rm(emptyRecordings, { recursive: true, force: true });
  }
});

posixTest('PATH-overlay Kilo mock passes discovery and reaches the ACP model probe', async () => {
  const recordings = await mkdtemp(path.join(tmpdir(), 'od-kilo-mock-detection-'));
  const trace = 'kilo-discovery-fixture';
  try {
    await writeFile(path.join(recordings, `${trace}.jsonl`), [
      JSON.stringify({ type: 'meta', model: 'default' }),
      JSON.stringify({ type: 'report', content: 'Mock Kilo response.' }),
      '',
    ].join('\n'));
    vi.stubEnv('PATH', [path.dirname(mockBin), path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter));
    vi.stubEnv('OD_AGENT_HOME', recordings);
    vi.stubEnv('OD_MOCKS_RECORDINGS_DIR', recordings);
    vi.stubEnv('OD_MOCKS_TRACE', trace);
    vi.stubEnv('OD_MOCKS_NO_DELAY', '1');

    const agent = await detectAgent(kiloAgentDef);
    expect(agent.path).toBe(mockBin);
    expect(agent.available).toBe(true);
    expect(agent.version).toBe('7.4.23');
    expect(agent.diagnostics).toBeUndefined();
    // A fallback list would hide a broken ACP handshake after the version gate.
    expect(agent.modelsSource).toBe('live');
    expect(agent.models).toEqual(kiloAgentDef.fallbackModels);
  } finally {
    await rm(recordings, { recursive: true, force: true });
  }
});
