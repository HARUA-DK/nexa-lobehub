import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  getInboxMessage: vi.fn(),
  getInboxUnreadCount: vi.fn(),
  getMailConversation: vi.fn(),
  getMailHtml: vi.fn(),
  list: vi.fn(),
  listInbox: vi.fn(),
  markAllInboxRead: vi.fn(),
  markInboxRead: vi.fn(),
  markMailRead: vi.fn(),
  revoke: vi.fn(),
  setMailStarred: vi.fn(),
  trashMail: vi.fn(),
}));
vi.mock('@/services/agentAccount', () => ({
  agentAccountService: service,
  AttachmentExpiredError: class extends Error {},
}));

// No provider configured: only already-owned addresses render.
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: unknown) => unknown) =>
    selector({ serverConfig: { agentIdentityProviders: [] } }),
}));

const ui = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  createModal: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmModal: ui.confirmModal,
  createModal: ui.createModal,
  toast: Object.assign(vi.fn(), { error: ui.toastError, success: vi.fn() }),
}));

const { IDENTITY_CHANNELS } = await import('./const');
const { default: InboxMessageDetail } = await import('./InboxMessageDetail');
const { default: InboxSection } = await import('./InboxSection');
const { INBOX_REFRESH_INTERVAL_MS, useAgentAccounts } = await import('./useAgentIdentity');

const fresh = (node: React.ReactNode) =>
  render(<SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{node}</SWRConfig>);

const mailChannel = IDENTITY_CHANNELS.find((channel) => channel.kind === 'mail')!;

beforeEach(() => {
  vi.clearAllMocks();
});

const detailProps = {
  accounts: [{ id: 'acc_1', status: 'active' }] as never,
  hasNext: true,
  hasPrevious: false,
  onBack: vi.fn(),
  onDraftStarted: vi.fn(),
  onEmptied: vi.fn(),
  onNext: vi.fn(),
  onPrevious: vi.fn(),
  onReadStateChange: vi.fn(),
  onRemoveFromList: vi.fn(() => vi.fn()),
  onReseated: vi.fn(),
  onRestored: vi.fn(),
  onServerChanged: vi.fn(),
};

const mailRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  accountId: 'acc_1',
  attachments: [],
  cc: [],
  deliveredAt: new Date('2026-10-02T00:00:00Z'),
  direction: 'inbound',
  fromAddress: `${id}@x.com`,
  id,
  inboxMessageId: id,
  isUnread: false,
  replyTo: [],
  starredAt: null,
  subject: 'Hello',
  text: `body of ${id}`,
  to: [{ address: 'agent@lobe.id' }],
  ...overrides,
});

describe('InboxMessageDetail', () => {
  beforeEach(() => {
    service.getMailHtml.mockResolvedValue({ status: 'none' });
  });

  it('shows a retryable error instead of a skeleton that never resolves', async () => {
    service.getMailConversation.mockRejectedValueOnce(new Error('network down'));

    fresh(<InboxMessageDetail {...detailProps} id={'msg_1'} />);

    expect(await screen.findByText('identity.inbox.detail.loadFailed')).toBeInTheDocument();
  });

  it('opens the newest mail and collapses the older one until asked', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('old'), mailRow('new')]);

    fresh(<InboxMessageDetail {...detailProps} id={'new'} />);

    expect(await screen.findAllByText('body of new')).not.toHaveLength(0);
    const [older] = screen.getAllByTestId('mail-summary');
    expect(older).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(older);

    expect(screen.getAllByTestId('mail-summary')[0]).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders HTML in a sandbox with no scripts and no same-origin', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.getMailHtml.mockResolvedValue({
      hasRemoteContent: true,
      html: '<p>rich</p>',
      status: 'ok',
    });

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    const frame = await screen.findByTestId('mail-html-frame');
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(screen.getByTestId('mail-remote-notice')).toBeInTheDocument();
  });

  it('falls back to the text and says so when the HTML has expired', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.getMailHtml.mockResolvedValue({ status: 'expired' });

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    expect(await screen.findByText('identity.inbox.detail.htmlExpired')).toBeInTheDocument();
    expect(screen.getByText('body of m')).toBeInTheDocument();
  });

  it('puts the star back and offers a retry when the write fails', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.setMailStarred.mockRejectedValueOnce(new Error('nope'));

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    const star = (await screen.findByTestId('mail-action-star')) as HTMLElement;
    fireEvent.click(star);

    await waitFor(() => expect(ui.toastError).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('mail-action-star')).toHaveAttribute('aria-pressed', 'false'),
    );
  });

  it('rolls back only the mails a failed mark-read changed', async () => {
    service.getMailConversation.mockResolvedValue([
      mailRow('read'),
      mailRow('unread', { isUnread: true }),
    ]);
    service.markMailRead.mockRejectedValue(new Error('nope'));
    detailProps.onReadStateChange.mockClear();

    fresh(<InboxMessageDetail {...detailProps} id={'unread'} />);

    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith(['unread']));
    await waitFor(() =>
      expect(detailProps.onReadStateChange).toHaveBeenLastCalledWith(
        [expect.objectContaining({ id: 'unread' })],
        true,
      ),
    );
    service.markMailRead.mockReset();
  });

  it('hands off to the page when trashing empties the conversation', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m')]);
    service.trashMail.mockResolvedValue({ count: 1, ids: ['m'] });

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    fireEvent.click(await screen.findByTestId('mail-action-trash'));

    await waitFor(() => expect(detailProps.onEmptied).toHaveBeenCalledWith(['m']));
    expect(service.trashMail).toHaveBeenCalledWith(['m']);
  });

  it('does not mark the landed-on conversation read until the reader touches it', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m', { isUnread: true })]);
    service.markMailRead.mockResolvedValue({ count: 1 });

    fresh(<InboxMessageDetail {...detailProps} deferRead id={'m'} />);

    const conversation = await screen.findByTestId('mail-conversation');
    expect(service.markMailRead).not.toHaveBeenCalled();

    fireEvent.pointerDown(conversation);

    await waitFor(() => expect(service.markMailRead).toHaveBeenCalledWith(['m']));
  });

  it('hides every write for a released address', async () => {
    service.getMailConversation.mockResolvedValue([mailRow('m', { accountId: 'gone' })]);

    fresh(<InboxMessageDetail {...detailProps} id={'m'} />);

    expect(await screen.findByText('identity.inbox.detail.released')).toBeInTheDocument();
    expect(screen.queryByTestId('mail-action-trash')).toBeNull();
    expect(screen.queryByTestId('mail-action-reply')).toBeNull();
  });
});

describe('InboxMessageDetail attachments', () => {
  it('lists what an attachment-only message carried instead of a blank body', async () => {
    service.getMailHtml.mockResolvedValue({ status: 'none' });
    service.getMailConversation.mockResolvedValue([
      mailRow('msg_photo', {
        attachments: [
          { contentType: 'image/jpeg', filename: 'photo.jpg', index: 0, size: 2_516_582 },
          { contentType: 'application/pdf', index: 1 },
        ],
        text: '',
      }),
    ]);

    fresh(<InboxMessageDetail {...detailProps} id={'msg_photo'} />);

    expect(await screen.findByText('photo.jpg')).toBeInTheDocument();
    expect(screen.getByText('2.4 MB')).toBeInTheDocument();
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    expect(screen.getAllByTestId('mail-attachment')).toHaveLength(2);
  });
});

describe('InboxSection', () => {
  const rows = [
    {
      from: 'friend@example.com',
      id: 'msg_1',
      readAt: null,
      receivedAt: new Date('2026-10-02T00:00:00Z'),
      subject: 'Lunch?',
    },
  ];

  it('reports the server unread count, not the dots on the loaded page', async () => {
    service.listInbox.mockResolvedValue(rows);
    service.getInboxUnreadCount.mockResolvedValue(73);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);

    await waitFor(() =>
      expect(service.getInboxUnreadCount).toHaveBeenCalledWith('agt_1', undefined),
    );
    expect(await screen.findByText('identity.inbox.unread')).toBeInTheDocument();
  });

  it('opens a message from the keyboard', async () => {
    service.listInbox.mockResolvedValue(rows);
    service.getInboxUnreadCount.mockResolvedValue(1);
    service.markInboxRead.mockResolvedValue({ count: 1 });

    const onOpen = vi.fn();
    fresh(<InboxSection agentId={'agt_1'} onOpen={onOpen} />);

    const row = await screen.findByRole('button', { name: /friend@example.com/ });
    expect(row).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });

    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(service.markInboxRead).toHaveBeenCalledWith(['msg_1']);
  });

  it('pages older mail with a cursor instead of an ever-growing limit', async () => {
    const page = (offset: number, size: number) =>
      Array.from({ length: size }, (_, i) => ({
        from: `sender${offset + i}@example.com`,
        id: `msg_${offset + i}`,
        readAt: new Date('2026-10-02T00:00:00Z'),
        receivedAt: new Date(Date.UTC(2026, 9, 2, 0, 0, 0) - (offset + i) * 1000),
        subject: `Mail ${offset + i}`,
      }));
    const first = page(0, 50);
    const second = page(50, 50);
    service.listInbox.mockImplementation(async ({ before }: { before?: unknown }) =>
      before ? ((before as any).id === 'msg_49' ? second : page(100, 3)) : first,
    );
    service.getInboxUnreadCount.mockResolvedValue(0);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);

    // Two clicks: beyond the server's 100-row cap if the window just grew.
    fireEvent.click(await screen.findByRole('button', { name: 'identity.inbox.loadMore' }));
    await screen.findByRole('button', { name: /sender99@example.com/ });
    fireEvent.click(screen.getByRole('button', { name: 'identity.inbox.loadMore' }));
    await screen.findByRole('button', { name: /sender102@example.com/ });

    const limits = service.listInbox.mock.calls.map(([params]) => params.limit);
    expect(Math.max(...limits)).toBe(50);
    expect(service.listInbox).toHaveBeenCalledWith(
      expect.objectContaining({ before: { id: 'msg_49', receivedAt: first[49].receivedAt } }),
    );
    // The short third page ends the list.
    expect(screen.queryByRole('button', { name: 'identity.inbox.loadMore' })).toBeNull();
  });

  it('keeps the loaded messages when an older page fails, with a retry below them', async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({
      from: `sender${i}@example.com`,
      id: `msg_${i}`,
      readAt: new Date('2026-10-02T00:00:00Z'),
      receivedAt: new Date(Date.UTC(2026, 9, 2) - i * 1000),
      subject: `Mail ${i}`,
    }));
    service.listInbox.mockImplementation(async ({ before }: { before?: unknown }) => {
      if (before) throw new Error('older page failed');
      return first;
    });
    service.getInboxUnreadCount.mockResolvedValue(0);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'identity.inbox.loadMore' }));

    expect(await screen.findByText('identity.inbox.loadFailed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sender0@example.com/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sender49@example.com/ })).toBeInTheDocument();
  });

  it('reports a failed refresh when the cached inbox is empty', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    service.listInbox.mockResolvedValueOnce([]).mockRejectedValue(new Error('inbox unavailable'));
    service.getInboxUnreadCount.mockResolvedValue(0);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);
    await screen.findByText('identity.inbox.empty');

    await vi.advanceTimersByTimeAsync(INBOX_REFRESH_INTERVAL_MS + 100);

    // An unreachable inbox must not read as an empty one.
    expect(await screen.findByText('identity.inbox.loadFailed')).toBeInTheDocument();
    expect(screen.getByText('identity.inbox.empty')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('picks up a delivery that lands while the tab stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    service.listInbox.mockResolvedValueOnce(rows).mockResolvedValue([
      {
        from: 'otp@service.com',
        id: 'msg_2',
        readAt: null,
        receivedAt: new Date('2026-10-02T00:01:00Z'),
        subject: 'Your code',
      },
      ...rows,
    ]);
    service.getInboxUnreadCount.mockResolvedValue(1);

    fresh(<InboxSection agentId={'agt_1'} onOpen={vi.fn()} />);
    await screen.findByRole('button', { name: /friend@example.com/ });

    await vi.advanceTimersByTimeAsync(INBOX_REFRESH_INTERVAL_MS + 100);

    expect(await screen.findByRole('button', { name: /otp@service.com/ })).toBeInTheDocument();
    vi.useRealTimers();
  });
});
