'use client';

import { Flexbox } from '@lobehub/ui';
import { useCallback, useRef } from 'react';
import { useLocation, useParams } from 'react-router';
import urlJoin from 'url-join';

import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { AgentMailView } from '@/services/agentAccount';
import { isMobileSurface } from '@/utils/mobileSurface';
import { StyleSheet } from '@/utils/styles';

import {
  type ConversationNeighbors,
  findNeighbors,
  nextSelectionAfterRemoval,
} from './conversation';
import InboxMessageDetail, { type InboxMessageDetailProps } from './InboxMessageDetail';
import InboxSection from './InboxSection';
import MailboxCard from './MailboxCard';
import MailSplitView from './MailSplitView';
import { identityStyles } from './styles';
import { useAgentInbox, useAgentInboxUnreadCount, useMailbox } from './useAgentIdentity';

const styles = StyleSheet.create({
  body: {
    display: 'flex',
    overflowY: 'auto',
    position: 'relative',
  },
});

interface AgentMailProps {
  agentId: string;
  /** Read-only viewer: addresses and mail stay readable, nothing can be opened or released. */
  disabled?: boolean;
}

/**
 * The agent's mail page: which mailbox is being read, and what has arrived.
 *
 * The open message lives in the URL, so a phone's back gesture leaves it and a
 * reload keeps it. A wide screen shows it beside the list; a phone gives it the
 * whole page.
 */
const MailPage = ({ agentId, disabled }: AgentMailProps) => {
  const { messageId } = useParams<{ messageId?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const mailbox = useMailbox(agentId, messageId);
  const mobile = isMobileSurface();
  const mailPath = urlJoin('/agent', agentId, 'mail');
  const location = useLocation();
  // The same SWR entries the list reads, so paging and edits stay in step with it.
  // Held until the mailbox is known, or every address's mail would be fetched first.
  const listAgentId = mailbox.isLoading && !mailbox.data ? '' : agentId;
  const list = useAgentInbox(listAgentId, mailbox.current?.id);
  const unreadCount = useAgentInboxUnreadCount(listAgentId, mailbox.current?.id);
  // A sent mail has no list row; one reached by reseating keeps the neighbours it left.
  const anchorRef = useRef<{ id?: string; neighbors: ConversationNeighbors }>({ neighbors: {} });
  const found = messageId ? findNeighbors(list.data ?? [], messageId) : {};
  const neighbors =
    found.nextId || found.previousId || anchorRef.current.id !== messageId
      ? found
      : anchorRef.current.neighbors;
  // Read once the row has left the list, by which point it has no neighbours left.
  const removalRef = useRef(neighbors);

  // Moving between messages replaces the entry, so back leaves the mail page.
  const openMessage = (id: string) => {
    // Pinned so the opened message does not have to be read to know its mailbox.
    mailbox.select(mailbox.current?.id);
    navigate(urlJoin(mailPath, id), { replace: Boolean(messageId) });
  };

  // Automatic, so the mail landed on is not read until the reader touches it.
  const selectAfterRemoval = useCallback(
    (id: string) => {
      navigate(urlJoin(mailPath, id), { replace: true, state: { deferRead: true } });
    },
    [mailPath, navigate],
  );

  const stepTo = async (direction: 'nextId' | 'previousId') => {
    let target = neighbors[direction];
    if (!target && direction === 'nextId' && list.hasMore && messageId) {
      const pages = await list.loadNextPage();
      target = pages ? findNeighbors(pages.flat(), messageId).nextId : undefined;
    }
    if (target) openMessage(target);
  };

  const detailProps: Omit<InboxMessageDetailProps, 'id'> = {
    accounts: mailbox.accounts,
    deferRead: Boolean((location.state as { deferRead?: boolean } | null)?.deferRead),
    disabled,
    hasNext: Boolean(neighbors.nextId) || list.hasMore,
    hasPrevious: Boolean(neighbors.previousId),
    onBack: () => navigate(mailPath, { replace: true }),
    onDraftStarted: (draftId) => navigate({ search: `?compose=${draftId}` }, { replace: true }),
    onEmptied: () => {
      const target = mobile ? undefined : nextSelectionAfterRemoval(removalRef.current);
      if (target) selectAfterRemoval(target);
      else navigate(mailPath, { replace: true });
    },
    onNext: () => void stepTo('nextId'),
    onPrevious: () => void stepTo('previousId'),
    onReadStateChange: (rows: AgentMailView[], unread: boolean) => {
      const ids = new Set(rows.map((row) => row.inboxMessageId));
      void list.mutate(
        (pages) =>
          pages?.map((page) =>
            page.map((row) =>
              ids.has(row.id)
                ? {
                    ...row,
                    markedUnread: unread,
                    readAt: unread ? row.readAt : (row.readAt ?? new Date()),
                  }
                : row,
            ),
          ),
        { revalidate: false },
      );
    },
    onRemoveFromList: (rows: AgentMailView[]) => {
      removalRef.current = neighbors;
      const ids = new Set(rows.map((row) => row.inboxMessageId));
      const pagesBefore = list.pages;
      void list.mutate((pages) => pages?.map((page) => page.filter((row) => !ids.has(row.id))), {
        revalidate: false,
      });
      return () => {
        if (pagesBefore) void list.mutate(pagesBefore, { revalidate: false });
      };
    },
    onReseated: (id) => {
      anchorRef.current = { id, neighbors };
      selectAfterRemoval(id);
    },
    onRestored: (id) => navigate(urlJoin(mailPath, id), { replace: true }),
    onServerChanged: () => Promise.all([list.mutate(), unreadCount.mutate()]),
  };

  const switchMailbox = (accountId: string) => {
    mailbox.select(accountId);
    if (messageId) navigate(mailPath, { replace: true });
  };

  const mailboxCard = (
    <MailboxCard agentId={agentId} disabled={disabled} mailbox={mailbox} onSwitch={switchMailbox} />
  );
  // Waits for the mailbox so the list never flashes every address's mail first.
  const inbox = !(mailbox.isLoading && !mailbox.data) && (
    <InboxSection
      accountId={mailbox.current?.id}
      agentId={agentId}
      selectedId={mobile ? undefined : messageId}
      onOpen={openMessage}
    />
  );

  return (
    <Flexbox height={'100%'} style={{ position: 'relative' }} width={'100%'}>
      {mobile ? (
        <>
          <NavHeader
            left={<AgentBreadcrumb agentId={agentId} />}
            // `relative` anchors the absolutely-centered switcher below.
            style={{ position: 'relative' }}
            styles={{
              // Center on the header midpoint (equal gaps), not the leftover track.
              center: AGENT_PROFILE_TABS_CENTER_STYLE,
              left: { minWidth: 0, paddingInlineStart: 8 },
            }}
          >
            <AgentProfileTabs active={'mail'} agentId={agentId} />
          </NavHeader>
          <Flexbox flex={1} style={styles.body} width={'100%'}>
            <WideScreenContainer>
              <Flexbox gap={24} paddingBlock={16}>
                {mailboxCard}
                {inbox}
              </Flexbox>
            </WideScreenContainer>
          </Flexbox>
        </>
      ) : (
        <MailSplitView
          detailProps={detailProps}
          inbox={inbox}
          mailbox={mailboxCard}
          messageId={messageId}
        />
      )}
      {/* Laid over the list instead of replacing it, so back returns to the same scroll. */}
      {mobile && messageId && (
        <Flexbox className={identityStyles.mobileDetail}>
          <NavHeader />
          <Flexbox flex={1} padding={16} style={styles.body} width={'100%'}>
            <InboxMessageDetail {...detailProps} id={messageId} key={messageId} />
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
};

/** Keyed so a selected mailbox never carries over to another agent. */
const AgentMail = (props: AgentMailProps) => <MailPage key={props.agentId} {...props} />;

export default AgentMail;
