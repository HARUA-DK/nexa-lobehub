'use client';

import { toast } from '@lobehub/ui';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { agentAccountService, type AgentMailView } from '@/services/agentAccount';

import { reseatTarget } from './conversation';

/** Long enough to read the toast and reach its button. */
const UNDO_DURATION_MS = 8000;

export interface UseConversationOptions {
  /** Trashing emptied this conversation; the page picks what to show next. */
  onEmptied: (ids: string[]) => void;
  /** Mirror a read-state change into the list at once. */
  onReadStateChange: (rows: AgentMailView[], unread: boolean) => void;
  /** Take trashed mail out of the list at once; returns how to put it back. */
  onRemoveFromList: (rows: AgentMailView[]) => () => void;
  /** The mail the URL points at was trashed but its conversation lives on. */
  onReseated: (id: string) => void;
  /** Undo brought it back. */
  onRestored: (id: string) => void;
  /** The list and counts changed on the server. */
  onServerChanged: () => Promise<unknown> | void;
}

/**
 * One open conversation and everything done to it. Every change shows first
 * and is put back with a toast offering retry if the server refuses it.
 */
export const useConversation = (id: string, options: UseConversationOptions) => {
  const { t } = useTranslation('setting');
  const swr = useSWR(['agent-mail-conversation', id], ([, mailId]) =>
    agentAccountService.getMailConversation(mailId),
  );
  const { data, mutate } = swr;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** Apply `patch` to the given mails, run the write, and undo it if the write fails. */
  const applyOptimistic = useCallback(
    async (
      ids: string[],
      patch: (mail: AgentMailView) => AgentMailView,
      write: () => Promise<unknown>,
      failure: string,
      onRollback?: () => void,
    ) => {
      const previous = data;
      const targets = new Set(ids);
      await mutate((rows) => rows?.map((row) => (targets.has(row.id) ? patch(row) : row)), {
        revalidate: false,
      });

      try {
        await write();
        await Promise.all([mutate(), optionsRef.current.onServerChanged()]);
      } catch (error) {
        console.error('[AgentMail] action failed', error);
        await mutate(previous, { revalidate: false });
        onRollback?.();
        toast.error({
          actions: [
            {
              label: t('identity.inbox.detail.retry'),
              onClick: () => void applyOptimistic(ids, patch, write, failure, onRollback),
            },
          ],
          title: failure,
        });
      }
    },
    [data, mutate, t],
  );

  const setStarred = useCallback(
    (ids: string[], starred: boolean) =>
      applyOptimistic(
        ids,
        (mail) => ({ ...mail, starredAt: starred ? new Date() : null }),
        () => agentAccountService.setMailStarred(ids, starred),
        t('identity.inbox.action.starFailed'),
      ),
    [applyOptimistic, t],
  );

  const setUnread = useCallback(
    (all: AgentMailView[], unread: boolean) => {
      // Only mails that actually flip, so a rollback can flip exactly those back.
      const rows = all.filter((row) => row.isUnread !== unread);
      if (rows.length === 0) return Promise.resolve();
      const ids = rows.map((row) => row.id);
      optionsRef.current.onReadStateChange(rows, unread);

      return applyOptimistic(
        ids,
        (mail) => ({ ...mail, isUnread: unread }),
        () =>
          unread ? agentAccountService.markMailUnread(ids) : agentAccountService.markMailRead(ids),
        t('identity.inbox.action.readFailed'),
        () => optionsRef.current.onReadStateChange(rows, !unread),
      );
    },
    [applyOptimistic, t],
  );

  /** Move mail to the trash; undo restores exactly these and reopens them. */
  const trash = useCallback(
    async (rows: AgentMailView[]) => {
      const ids = rows.map((row) => row.id);
      const remaining = data?.filter((row) => !ids.includes(row.id)) ?? [];
      const previous = data;
      const putBack = optionsRef.current.onRemoveFromList(rows);
      const emptied = remaining.length === 0;

      await mutate(remaining, { revalidate: false });
      if (emptied) optionsRef.current.onEmptied(ids);
      else if (rows.some((row) => row.id === id || row.inboxMessageId === id)) {
        optionsRef.current.onReseated(reseatTarget(remaining)!);
      }

      try {
        await agentAccountService.trashMail(ids);
      } catch (error) {
        console.error('[AgentMail] trash failed', error);
        putBack();
        await mutate(previous, { revalidate: false });
        if (emptied) optionsRef.current.onRestored(id);
        toast.error({
          actions: [{ label: t('identity.inbox.detail.retry'), onClick: () => void trash(rows) }],
          title: t('identity.inbox.action.trashFailed'),
        });
        return;
      }

      void optionsRef.current.onServerChanged();
      toast.success({
        actions: [
          {
            label: t('identity.inbox.action.undo'),
            onClick: async () => {
              try {
                await agentAccountService.restoreMail(ids);
                await mutate();
                await optionsRef.current.onServerChanged();
                optionsRef.current.onRestored(id);
              } catch (error) {
                console.error('[AgentMail] undo failed', error);
                toast.error(t('identity.inbox.action.undoFailed'));
              }
            },
          },
        ],
        duration: UNDO_DURATION_MS,
        title: t('identity.inbox.action.trashed', { count: ids.length }),
      });
    },
    [data, id, mutate, t],
  );

  /** A reply or forward starts life as a draft, so nothing is lost before it is sent. */
  const startDraft = useCallback(
    async (mode: 'forward' | 'reply', mail: AgentMailView) => {
      const reply = mode === 'reply';
      const source = mail.subject ?? '';
      const prefix = reply ? 'Re: ' : 'Fwd: ';
      const replyTo = mail.replyTo?.length
        ? mail.replyTo
        : [{ address: mail.fromAddress, name: mail.fromName ?? undefined }];

      try {
        const draft = await agentAccountService.createMailDraft({
          accountId: mail.accountId,
          mode,
          sourceMailId: mail.id,
          subject: source.toLowerCase().startsWith(prefix.toLowerCase()) ? source : prefix + source,
          text: '',
          to: reply ? replyTo : [],
        });
        toast.success(t('identity.inbox.action.draftCreated'));
        return draft;
      } catch (error) {
        console.error('[AgentMail] draft failed', error);
        toast.error(
          error instanceof Error ? error.message : t('identity.inbox.action.draftFailed'),
        );
        return undefined;
      }
    },
    [t],
  );

  return { ...swr, setStarred, setUnread, startDraft, trash };
};
