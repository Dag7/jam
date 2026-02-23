import { describe, it, expect, afterEach } from 'vitest';
import { stripAnsi, stripAnsiSimple, createSecretRedactor, buildCleanEnv } from '../utils.js';

describe('stripAnsi', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('removes CSI sequences with parameters', () => {
    expect(stripAnsi('\x1b[1;32;40mtext\x1b[0m')).toBe('text');
  });

  it('removes OSC sequences terminated by BEL', () => {
    expect(stripAnsi('\x1b]0;window title\x07rest')).toBe('rest');
  });

  it('removes OSC sequences terminated by ST', () => {
    expect(stripAnsi('\x1b]0;title\x1b\\rest')).toBe('rest');
  });

  it('removes DEC private mode sequences', () => {
    expect(stripAnsi('\x1b[?25hvisible\x1b[?25l')).toBe('visible');
  });

  it('removes charset escape sequences', () => {
    expect(stripAnsi('\x1b(Btext\x1b(0')).toBe('text');
  });

  it('removes simple escape sequences', () => {
    expect(stripAnsi('\x1bMtext')).toBe('text');
  });

  it('removes carriage returns', () => {
    expect(stripAnsi('hello\rworld')).toBe('helloworld');
  });

  it('returns empty string for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('passes through plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles mixed escape types in one string', () => {
    const input = '\x1b[32m\x1b]0;title\x07hello\x1b(B\rworld\x1b[0m';
    expect(stripAnsi(input)).toBe('helloworld');
  });
});

describe('stripAnsiSimple', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsiSimple('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('removes multi-param CSI sequences', () => {
    expect(stripAnsiSimple('\x1b[1;32;40mtext\x1b[0m')).toBe('text');
  });

  it('does NOT remove OSC sequences (simple mode)', () => {
    const input = '\x1b]0;title\x07rest';
    expect(stripAnsiSimple(input)).toBe(input);
  });

  it('does NOT remove carriage returns (simple mode)', () => {
    expect(stripAnsiSimple('hello\rworld')).toBe('hello\rworld');
  });

  it('returns empty string for empty input', () => {
    expect(stripAnsiSimple('')).toBe('');
  });
});

describe('createSecretRedactor', () => {
  it('redacts a single secret value', () => {
    const redact = createSecretRedactor(['my-secret-key-12345']);
    expect(redact('token: my-secret-key-12345')).toBe('token: ***');
  });

  it('redacts multiple secret values', () => {
    const redact = createSecretRedactor(['secret-aaa-111', 'secret-bbb-222']);
    expect(redact('a=secret-aaa-111 b=secret-bbb-222')).toBe('a=*** b=***');
  });

  it('ignores short secrets (< 8 chars)', () => {
    const redact = createSecretRedactor(['short']);
    expect(redact('short value')).toBe('short value');
  });

  it('returns identity function when all secrets are short', () => {
    const redact = createSecretRedactor(['abc', '12']);
    const input = 'abc and 12';
    expect(redact(input)).toBe(input);
  });

  it('returns identity function for empty array', () => {
    const redact = createSecretRedactor([]);
    expect(redact('anything')).toBe('anything');
  });

  it('handles repeated occurrences of the same secret', () => {
    const redact = createSecretRedactor(['repeating-secret']);
    expect(redact('repeating-secret and repeating-secret')).toBe('*** and ***');
  });

  it('does not redact when secret is not present', () => {
    const redact = createSecretRedactor(['absent-secret-key']);
    expect(redact('no secrets here')).toBe('no secrets here');
  });
});

describe('buildCleanEnv', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('copies process.env values', () => {
    process.env = { PATH: '/usr/bin', HOME: '/home/user' };
    const env = buildCleanEnv();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
  });

  it('filters out CLAUDECODE', () => {
    process.env = { PATH: '/usr/bin', CLAUDECODE: '1' };
    const env = buildCleanEnv();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.CLAUDECODE).toBeUndefined();
  });

  it('filters out CLAUDE_PARENT_CLI', () => {
    process.env = { PATH: '/usr/bin', CLAUDE_PARENT_CLI: 'true' };
    const env = buildCleanEnv();
    expect(env.CLAUDE_PARENT_CLI).toBeUndefined();
  });

  it('merges extra vars', () => {
    process.env = { PATH: '/usr/bin' };
    const env = buildCleanEnv({ CUSTOM: 'value' });
    expect(env.CUSTOM).toBe('value');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('extra vars override filtered values', () => {
    process.env = { PATH: '/usr/bin' };
    const env = buildCleanEnv({ PATH: '/custom/bin' });
    expect(env.PATH).toBe('/custom/bin');
  });
});
