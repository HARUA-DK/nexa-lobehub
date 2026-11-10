import { checkAuth } from '@/app/(backend)/middleware/auth';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { AgentAccountService } from '@/server/services/agentIdentity';
import { AgentMailboxService } from '@/server/services/agentIdentity/mailbox';
import { createDefaultAgentAccountRegistry } from '@/server/services/agentIdentity/providers';

import { resolveValidWorkspaceIdFromRequest } from '../../_utils/workspace';

export const runtime = 'nodejs';

const jsonError = (error: string, status: number) => Response.json({ error }, { status });

/** A filename for the header: never breaks out of it, and survives non-ASCII names. */
const contentDisposition = (filename: string) => {
  const ascii = filename.replaceAll(/[^\u0020-\u007E]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

/**
 * One attachment of a mail, proxied so the browser never talks to the provider
 * and the same ownership scope as reading the mail applies. Always a download,
 * with sniffing off: the bytes come from whoever sent the mail. A route rather
 * than tRPC because attachments do not fit a JSON response.
 */
export const GET = checkAuth(async (req, { userId, serverDB }) => {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const index = Number(searchParams.get('index'));
  if (!id || !Number.isInteger(index) || index < 0) return jsonError('invalid request', 400);

  const workspaceId = await resolveValidWorkspaceIdFromRequest({ req, serverDB, userId });
  const accounts = new AgentAccountService(serverDB, userId, {
    gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
    registry: createDefaultAgentAccountRegistry(),
    workspaceId,
  });
  const mailbox = new AgentMailboxService(serverDB, userId, { accounts, workspaceId });

  let file: Awaited<ReturnType<AgentMailboxService['readAttachment']>>;
  try {
    file = await mailbox.readAttachment(id, index);
  } catch (error) {
    // Not "expired": the bytes may well be there, so the reader can retry.
    console.error('[agent-mail:attachment] download failed', error);
    return jsonError('unavailable', 502);
  }
  if (!file) return jsonError('expired', 404);

  const name = file.filename || `attachment-${index}`;
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': contentDisposition(name),
      'Content-Length': String(file.buffer.byteLength),
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
