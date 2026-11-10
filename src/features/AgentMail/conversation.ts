import type { AgentInboxMessageSummary } from '@lobechat/types';

/** The part of a mail these rules read, so they stay testable without a full row. */
export interface ConversationMail {
  id: string;
  isUnread: boolean;
}

/** Collapsed mails in a row beyond this fold into one "show N more" line. */
export const FOLD_RUN_THRESHOLD = 6;

/** Open by default: every unread mail, and always the newest. */
export const initialExpandedIds = (mails: ConversationMail[]): Set<string> => {
  const expanded = new Set(mails.filter((mail) => mail.isUnread).map((mail) => mail.id));
  const last = mails.at(-1);
  if (last) expanded.add(last.id);
  return expanded;
};

/** Only what opening actually shows is read, so a fold never hides an unread mail. */
export const idsToMarkReadOnOpen = (mails: ConversationMail[]): string[] =>
  mails.filter((mail) => mail.isUnread).map((mail) => mail.id);

/** Where the reader starts: the first unread, else the newest. */
export const initialFocusId = (mails: ConversationMail[]): string | undefined =>
  (mails.find((mail) => mail.isUnread) ?? mails.at(-1))?.id;

export type ConversationRow =
  { id: string; kind: 'mail' } | { count: number; firstHiddenIndex: number; kind: 'fold' };

/** Long runs of collapsed mail become one line; the runs either side stay visible. */
export const buildConversationRows = (
  mails: ConversationMail[],
  expanded: Set<string>,
  unfolded: boolean,
): ConversationRow[] => {
  if (unfolded) return mails.map(({ id }) => ({ id, kind: 'mail' }));

  const rows: ConversationRow[] = [];
  let index = 0;

  while (index < mails.length) {
    let end = index;
    while (end < mails.length && !expanded.has(mails[end].id)) end += 1;
    const run = end - index;

    if (run >= FOLD_RUN_THRESHOLD) {
      rows.push({ id: mails[index].id, kind: 'mail' });
      rows.push({ count: run - 2, firstHiddenIndex: index + 1, kind: 'fold' });
      rows.push({ id: mails[end - 1].id, kind: 'mail' });
    } else {
      for (let cursor = index; cursor < end; cursor += 1) {
        rows.push({ id: mails[cursor].id, kind: 'mail' });
      }
    }

    if (end < mails.length) rows.push({ id: mails[end].id, kind: 'mail' });
    index = end + 1;
  }

  return rows;
};

/**
 * Where the URL moves when the mail it names is trashed but its conversation
 * lives on: an inbox item when one survives, since only those are list rows.
 */
export const reseatTarget = (
  remaining: { id: string; inboxMessageId: null | string }[],
): string | undefined => {
  const survivor = remaining.findLast((row) => row.inboxMessageId) ?? remaining.at(-1);
  return survivor ? (survivor.inboxMessageId ?? survivor.id) : undefined;
};

type ListRow = Pick<AgentInboxMessageSummary, 'accountId' | 'id' | 'threadKey'>;

const conversationKey = (row: ListRow) =>
  row.threadKey ? `${row.accountId}:${row.threadKey}` : row.id;

/** The list as conversations: the first (newest) row of each, in list order. */
export const conversationOrder = <T extends ListRow>(rows: T[]): T[] => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = conversationKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export interface ConversationNeighbors {
  /** Older, towards the bottom. */
  nextId?: string;
  /** Newer, towards the top of the list. */
  previousId?: string;
}

/** The rows either side of the conversation holding `id`, skipping its other mails. */
export const findNeighbors = (rows: ListRow[], id: string): ConversationNeighbors => {
  const current = rows.find((row) => row.id === id);
  if (!current) return {};

  const order = conversationOrder(rows);
  const index = order.findIndex((row) => conversationKey(row) === conversationKey(current));

  return { nextId: order[index + 1]?.id, previousId: order[index - 1]?.id };
};

/** Where to land after this conversation leaves the list: older first, else newer. */
export const nextSelectionAfterRemoval = ({ nextId, previousId }: ConversationNeighbors) =>
  nextId ?? previousId;
