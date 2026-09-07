import net from 'node:net';

export interface FakeSmtpOptions {
  /** Reply sent on connect. Use a multi-line string to test continuations. */
  greeting?: string;
  /** Reply to `RCPT TO` keyed by the recipient address. */
  recipients?: Record<string, string>;
  /** Reply for any recipient not listed above. */
  defaultRcpt?: string;
  /** Reply to `MAIL FROM`. */
  mailFrom?: string;
  /** Drop the connection immediately instead of speaking SMTP. */
  hangUp?: boolean;
}

export interface FakeSmtp {
  port: number;
  /** Every command line the server received, in order. */
  commands: string[];
  close(): Promise<void>;
}

/** A scriptable SMTP server, so the probe logic can be tested without port 25. */
export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const {
    greeting = '220 fake.test ESMTP ready',
    recipients = {},
    defaultRcpt = '550 5.1.1 No such user here',
    mailFrom = '250 2.1.0 Sender ok',
    hangUp = false,
  } = options;

  const commands: string[] = [];

  const server = net.createServer((socket) => {
    if (hangUp) {
      socket.destroy();
      return;
    }
    socket.setEncoding('ascii');
    socket.write(`${greeting}\r\n`);

    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        commands.push(line);

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) {
          socket.write('250-fake.test\r\n250 SIZE 10240000\r\n');
        } else if (upper.startsWith('HELO')) {
          socket.write('250 fake.test\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write(`${mailFrom}\r\n`);
        } else if (upper.startsWith('RCPT TO')) {
          const address = /<([^>]*)>/.exec(line)?.[1] ?? '';
          socket.write(`${recipients[address] ?? defaultRcpt}\r\n`);
        } else if (upper.startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
    socket.on('error', () => undefined); // The client destroys the socket on QUIT.
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('Failed to bind fake SMTP server');
  }

  return {
    port: address.port,
    commands,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
