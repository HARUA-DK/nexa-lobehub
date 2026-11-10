'use client';

import { Button, Center, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentAccountView, AgentMailView } from '@/services/agentAccount';

import {
  buildConversationRows,
  idsToMarkReadOnOpen,
  initialExpandedIds,
  initialFocusId,
} from './conversation';
import ConversationMessage from './ConversationMessage';
import InlineError from './InlineError';
import MailDetailToolbar from './MailDetailToolbar';
import { useConversation, type UseConversationOptions } from './useConversation';

export interface InboxMessageDetailProps extends UseConversationOptions {
  /** The addresses still held; the mail's own may have been released since. */
  accounts: Pick<AgentAccountView, 'id' | 'status'>[];
  /** Landed here because the last conversation left, so reading waits for the reader. */
  deferRead?: boolean;
  /** Read-only viewer: mail stays readable, nothing can be changed or sent. */
  disabled?: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  id: string;
  onBack: () => void;
  onDraftStarted: (draftId: string) => void;
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * One conversation, read by id rather than taken from a possibly stale list row.
 * Older mail collapses to a summary line; the newest and anything unread open.
 */
const InboxMessageDetail = memo<InboxMessageDetailProps>(
  ({
    accounts,
    deferRead,
    disabled,
    hasNext,
    hasPrevious,
    id,
    onBack,
    onDraftStarted,
    onNext,
    onPrevious,
    ...options
  }) => {
    const { t } = useTranslation('setting');
    const {
      data: mails,
      error,
      isLoading,
      mutate,
      setStarred,
      setUnread,
      startDraft,
      trash,
    } = useConversation(id, options);

    const [expanded, setExpanded] = useState<Set<string>>();
    const [unfolded, setUnfolded] = useState(false);
    const [readArmed, setReadArmed] = useState(!deferRead);
    const openedRef = useRef(false);
    const focusRef = useRef<HTMLDivElement>(null);

    // Seed once per opened conversation: a poll must not undo what the reader toggled.
    useEffect(() => {
      if (!mails || mails.length === 0 || expanded) return;
      setExpanded(initialExpandedIds(mails));
    }, [expanded, mails]);

    useEffect(() => {
      if (expanded) focusRef.current?.scrollIntoView({ block: 'nearest' });
      // Only the first placement; later toggles keep the reader where they are.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Boolean(expanded)]);

    // One open is one read, so marking unread here does not bounce straight back.
    useEffect(() => {
      if (!mails || mails.length === 0 || openedRef.current || !readArmed) return;
      openedRef.current = true;
      const unread = idsToMarkReadOnOpen(mails);
      if (unread.length > 0)
        void setUnread(
          mails.filter((mail) => unread.includes(mail.id)),
          false,
        );
    }, [mails, readArmed, setUnread]);

    if (error && !mails) {
      return (
        <Flexbox padding={4}>
          <InlineError
            detail={error instanceof Error ? error.message : String(error)}
            summary={t('identity.inbox.detail.loadFailed')}
            onRetry={() => void mutate()}
          />
        </Flexbox>
      );
    }

    if (isLoading || !mails) {
      return (
        <Flexbox gap={12} padding={4}>
          <Skeleton height={32} width={'40%'} />
          <Skeleton height={20} width={'60%'} />
          <Skeleton height={120} width={'100%'} />
        </Flexbox>
      );
    }

    if (mails.length === 0) {
      return (
        <Center gap={12} paddingBlock={48}>
          <Text type={'secondary'}>{t('identity.inbox.detail.gone')}</Text>
          <Button onClick={onBack}>{t('identity.inbox.detail.backToList')}</Button>
        </Center>
      );
    }

    const newest = mails.at(-1)!;
    const account = accounts.find((item) => item.id === newest.accountId);
    const released = !account;
    const readOnly = Boolean(disabled) || released;
    const canSend = !readOnly && account?.status === 'active';
    // A sent mail can only be answered through the conversation's last received one.
    const replyTarget = mails.findLast((mail) => mail.direction === 'inbound') ?? newest;
    const focusId = initialFocusId(mails);
    const open = expanded ?? new Set<string>();
    const anyUnread = mails.some((mail) => mail.isUnread);
    const starredIds = mails.filter((mail) => mail.starredAt).map((mail) => mail.id);
    const rows = buildConversationRows(mails, open, unfolded);
    const byId = new Map(mails.map((mail) => [mail.id, mail]));

    const startFrom = async (mode: 'forward' | 'reply', mail: AgentMailView) => {
      const draft = await startDraft(mode, mail);
      if (draft) onDraftStarted(draft.id);
    };

    const toggle = (mail: AgentMailView) => {
      const opening = !open.has(mail.id);
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(mail.id)) next.delete(mail.id);
        else next.add(mail.id);
        return next;
      });
      if (opening && mail.isUnread) void setUnread([mail], false);
    };

    return (
      <Flexbox
        gap={12}
        padding={4}
        onKeyDownCapture={() => setReadArmed(true)}
        onPointerDownCapture={() => setReadArmed(true)}
      >
        <MailDetailToolbar
          hasNext={hasNext}
          hasPrevious={hasPrevious}
          starred={starredIds.length > 0}
          unread={anyUnread}
          onForward={canSend ? () => void startFrom('forward', newest) : undefined}
          onNext={onNext}
          onPrevious={onPrevious}
          onReply={canSend ? () => void startFrom('reply', replyTarget) : undefined}
          onToggleRead={readOnly ? undefined : () => void setUnread(mails, !anyUnread)}
          onTrash={readOnly ? undefined : () => void trash(mails)}
          onToggleStar={
            readOnly
              ? undefined
              : () =>
                  void (starredIds.length > 0
                    ? setStarred(starredIds, false)
                    : setStarred([newest.id], true))
          }
        />
        {released && (
          <Text fontSize={12} type={'secondary'}>
            {t('identity.inbox.detail.released')}
          </Text>
        )}
        <Flexbox horizontal align={'baseline'} gap={8}>
          <Text fontSize={16} weight={600}>
            {newest.subject || t('identity.inbox.noSubject')}
          </Text>
          {mails.length > 1 && (
            <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
              {t('identity.inbox.detail.count', { count: mails.length })}
            </Text>
          )}
        </Flexbox>
        <Flexbox data-testid={'mail-conversation'} gap={8}>
          {rows.map((row) => {
            if (row.kind === 'fold') {
              return (
                <Button
                  block
                  data-testid={'mail-fold'}
                  key={`fold-${row.firstHiddenIndex}`}
                  size={'small'}
                  type={'text'}
                  onClick={() => setUnfolded(true)}
                >
                  {t('identity.inbox.detail.showMore', { count: row.count })}
                </Button>
              );
            }
            const mail = byId.get(row.id)!;
            return (
              <div key={mail.id} ref={mail.id === focusId ? focusRef : undefined}>
                <ConversationMessage
                  expanded={open.has(mail.id)}
                  mail={mail}
                  onForward={canSend ? () => void startFrom('forward', mail) : undefined}
                  onToggle={() => toggle(mail)}
                  onTrash={readOnly ? undefined : () => void trash([mail])}
                  onReply={
                    canSend && mail.direction === 'inbound'
                      ? () => void startFrom('reply', mail)
                      : undefined
                  }
                  onToggleStar={
                    readOnly ? undefined : () => void setStarred([mail.id], !mail.starredAt)
                  }
                />
              </div>
            );
          })}
        </Flexbox>
      </Flexbox>
    );
  },
);

InboxMessageDetail.displayName = 'AgentInboxMessageDetail';

export default InboxMessageDetail;
